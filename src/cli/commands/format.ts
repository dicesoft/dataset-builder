/**
 * Format command - Phase 7 will expand this
 * Basic implementation for Phase 1 integration
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import path from 'path';
import {
  formatDataset,
  listFormatters,
  getFormattersByCategory,
  parseSplitRatios,
} from '../../formatters';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { CLIError, ErrorCodes } from '../../utils/errorCodes';
import {
  generateTaskId,
  createTaskStructure,
  createTaskMetadata,
  updateTaskStatus,
} from '../../utils/taskManager';
import type { ExtendedFormatOptions } from '../../formatters';
import { ProgressSpinner } from '../../utils/tui';
import { safeJsonParse } from '../../utils/json';

/**
 * Create the format command
 */
export function createFormatCommand(): Command {
  const command = new Command('format')
    .description('Format dataset into ML/LLM/Vision/Audio standard formats')
    .option('-i, --input <path>', 'Input file path (JSON, JSONL, or CSV)')
    .option('-o, --output <dir>', 'Output directory')
    .option('-f, --format <name>', 'Target format (e.g., alpaca, chatml, llava)')
    .option('--split <ratios>', 'Train/val/test split ratios (e.g., "80:10:10")', '80:10:10')
    .option('--seed <number>', 'Random seed for reproducible splits', '42')
    .option('--field-map <json>', 'Field mapping as JSON object')
    .option('--field-map-file <file>', 'Field mapping from JSON file')
    .option('--system-prompt <text>', 'System prompt for chat-based formats')
    .option('--dataset-name <name>', 'Dataset name for metadata')
    .option('--image-field <field>', 'Field containing image paths')
    .option('--audio-field <field>', 'Field containing audio paths')
    .option('--copy-media', 'Copy media files to output directory', false)
    .option('--generate-card', 'Generate dataset card', false)
    .option('--no-split', 'Do not split data (output all to single file)')
    .option('--list-formats', 'List available formats')
    .option('--help-format <name>', 'Show help for specific format')
    // Cleanup options (Phase 2)
    .option('--cleanup', 'Enable data cleanup pipeline', false)
    .option('--cleanup-dedupe', 'Enable deduplication', false)
    .option('--cleanup-validate', 'Enable field validation', false)
    .option('--cleanup-quality', 'Enable LLM quality scoring', false)
    .option('--required-fields <fields>', 'Comma-separated list of required fields')
    .option(
      '--validate-file-fields <fields>',
      'Comma-separated list of file path fields to validate'
    )
    .option('--quality-threshold <number>', 'Minimum quality score (1-10)', '7')
    .option('--min-length <number>', 'Minimum content length')
    .option('--max-length <number>', 'Maximum content length')
    .option('--remove-empty', 'Remove records with empty fields', false)
    .option('--base-path <path>', 'Base path for resolving relative file paths')
    // Formatter-specific options
    .option(
      '--conversation-id-field <field>',
      'Field for multi-turn conversation grouping (ChatML)'
    )
    .option(
      '--role-map <json>',
      'Role mapping as JSON (ChatML), e.g. \'{"user":"question","assistant":"answer"}\''
    )
    .option('--conversation-field <field>', 'Field for conversation threading (ShareGPT)')
    .option('--human-field <field>', 'Field name for human messages (ShareGPT)')
    .option('--assistant-field <field>', 'Field name for assistant messages (ShareGPT)')
    .option('--tree-id-field <field>', 'Field containing message tree ID (OASST)')
    .option('--parent-id-field <field>', 'Field containing parent message ID (OASST)')
    .option('--lang <code>', 'Language code for messages (OASST), e.g. "en"')
    .option('--include-system <bool>', 'Include system message in chat formats (default: true)')
    .option(
      '--include-empty-input <bool>',
      'Include empty input field in Alpaca format (default: true)'
    )
    .option('--default-input <text>', 'Default value for empty input field (Alpaca)')
    // Vision formatter options (Phase 4)
    .option('--image-token <token>', 'Image placeholder token (LLaVA, default: "<image>")')
    .option('--embed-images', 'Embed images as base64 in output (LLaVA)', false)
    .option('--max-embed-size <bytes>', 'Maximum image size for base64 embedding in bytes')
    .option('--class-field <field>', 'Field containing class/category label (ImageFolder, YOLO)')
    .option(
      '--image-extensions <exts>',
      'Comma-separated list of allowed image extensions (ImageFolder)'
    )
    .option('--mask-field <field>', 'Field containing mask file paths (COCO-Seg, YOLO-Seg)')
    .option('--bbox-field <field>', 'Field containing bounding boxes (COCO, YOLO)')
    .option('--category-id-field <field>', 'Field containing category ID (COCO)')
    .option('--category-name-field <field>', 'Field containing category name (COCO)')
    .option('--image-width <pixels>', 'Image width for bbox normalization (YOLO)')
    .option('--image-height <pixels>', 'Image height for bbox normalization (YOLO)')
    // Audio formatter options (Phase 5)
    .option(
      '--audio-extensions <exts>',
      'Comma-separated list of allowed audio extensions (AudioFolder, SpeechText)'
    )
    .option('--text-field <field>', 'Field containing transcription text (SpeechText)')
    .option('--duration-field <field>', 'Field containing pre-existing duration (SpeechText)')
    .option('--extract-duration', 'Use ffprobe to extract audio duration (SpeechText)', false)
    // HuggingFace formatter options (Phase 6)
    // Dataset card metadata options
    .option('--license <id>', 'License identifier for dataset card (e.g., "mit", "apache-2.0")')
    .option(
      '--task-categories <list>',
      'Comma-separated task categories (e.g., "text-generation,question-answering")'
    )
    .option(
      '--card-language <list>',
      'Comma-separated language codes for dataset card (e.g., "en,es")'
    )
    .option('--card-description <text>', 'Description text for dataset card')
    // HuggingFace formatter options (Phase 6)
    .addOption(
      new Option(
        '--output-format <format>',
        'Output format for HF formatters: json (default) or parquet'
      ).choices(['json', 'parquet'])
    )
    .option('--features <json>', 'HF features schema as JSON (auto-inferred if not provided)')
    .option(
      '--stratified-field <field>',
      'Field for stratified splitting (maintain class distribution)'
    )
    .action(
      wrapAction('format', async (options) => {
        // Fix multi-word values split by enablePositionalOptions()
        if (Array.isArray(options.systemPrompt))
          options.systemPrompt = options.systemPrompt.join(' ');

        try {
          // Handle --list-formats
          if (options.listFormats) {
            const formats = listFormatters();
            if (isJsonMode()) {
              outputResult('format', { formats });
              return;
            }
            console.log(chalk.cyan('Available formats:'));
            for (const { name, description } of formats) {
              console.log(`  ${chalk.bold(name)} - ${description}`);
            }
            return;
          }

          // Handle --help-format
          if (options.helpFormat) {
            printFormatHelp(options.helpFormat);
            return;
          }

          // Handle --dry-run (check before validation so we can still show the plan)
          if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
            const planned_actions: string[] = [];
            if (options.input) {
              planned_actions.push(`Read input: ${options.input}`);
            } else {
              planned_actions.push('Input: (not specified)');
            }
            planned_actions.push(`Format as: ${options.format || '(not specified)'}`);
            if (options.split && !options.noSplit) {
              planned_actions.push(`Split data with ratios: ${options.split}`);
            }
            const outputDir = options.output || `./output/<taskId>/formatted`;
            planned_actions.push(`Write output to: ${outputDir}`);
            if (options.cleanup) planned_actions.push('Run cleanup pipeline');
            if (options.generateCard) planned_actions.push('Generate dataset card');

            outputResult('format', {
              dry_run: true,
              command: 'format',
              planned_actions,
              estimated: {
                formatter: options.format || null,
                outputDir,
              },
            });
            if (!isJsonMode()) {
              console.log(chalk.yellow('Dry run - no files will be written.'));
              for (const action of planned_actions) {
                console.log(chalk.gray(`  - ${action}`));
              }
            }
            return;
          }

          // Validate required options
          if (!options.input) {
            if (!isJsonMode()) {
              console.error(chalk.red('Error: Input file is required (--input)'));
            }
            exitWithCode(ExitCode.INVALID_INPUT, 'Input file is required (--input)');
          }

          if (!options.format) {
            if (!isJsonMode()) {
              console.error(chalk.red('Error: Target format is required (--format)'));
              console.error(chalk.yellow('Use --list-formats to see available formats'));
            }
            exitWithCode(ExitCode.INVALID_INPUT, 'Target format is required (--format)');
          }

          // Load field map from file or string
          let fieldMap: Record<string, string> = {};
          if (options.fieldMapFile) {
            const fs = await import('fs/promises');
            const content = await fs.readFile(options.fieldMapFile, 'utf-8');
            fieldMap = safeJsonParse(content, 'format input file') as Record<string, string>;
          } else if (options.fieldMap) {
            try {
              fieldMap = JSON.parse(options.fieldMap);
            } catch {
              // Try shorthand: key:value,key:value
              const pairs = options.fieldMap.split(',');
              const parsed: Record<string, string> = {};
              let valid = true;
              for (const pair of pairs) {
                const colonIdx = pair.indexOf(':');
                if (colonIdx === -1) {
                  valid = false;
                  break;
                }
                const key = pair.slice(0, colonIdx).trim();
                const value = pair.slice(colonIdx + 1).trim();
                if (key && value) parsed[key] = value;
                else {
                  valid = false;
                  break;
                }
              }
              if (valid && Object.keys(parsed).length > 0) {
                fieldMap = parsed;
              } else {
                if (!isJsonMode()) {
                  console.error(
                    chalk.red('Error: --field-map must be valid JSON or key:value,key:value format')
                  );
                  console.error(
                    chalk.yellow('  JSON example: --field-map \'{"q":"instruction","a":"output"}\'')
                  );
                  console.error(
                    chalk.yellow('  Shorthand:    --field-map "q:instruction,a:output"')
                  );
                }
                exitWithCode(
                  ExitCode.INVALID_INPUT,
                  '--field-map must be valid JSON or key:value,key:value format'
                );
              }
            }
          }

          // Validate field-map structure: must be a plain object with string keys and string values
          validateStringMap(fieldMap, '--field-map');

          // Create task
          const taskId = generateTaskId();
          const outputDir = options.output || path.join('./output', taskId, 'formatted');
          await createTaskStructure(taskId, ['formatted'], './output');
          await createTaskMetadata(
            taskId,
            `format -f ${options.format} -i ${options.input}`,
            './output',
            { format: options.format, fieldMap },
            'export'
          );

          if (!isJsonMode()) {
            console.log(chalk.cyan(`Formatting dataset...`));
            console.log(chalk.gray(`  Task ID: ${taskId}`));
            console.log(chalk.gray(`  Format: ${options.format}`));
            console.log(chalk.gray(`  Input: ${options.input}`));
            console.log(chalk.gray(`  Output: ${outputDir}`));
          }

          // Parse split ratios
          const splitRatios =
            options.noSplit || !options.split ? undefined : parseSplitRatios(String(options.split));

          // Build cleanup options
          const cleanupOptions =
            options.cleanup ||
            options.cleanupDedupe ||
            options.cleanupValidate ||
            options.cleanupQuality ||
            options.removeEmpty
              ? {
                  dedupe: options.cleanupDedupe || options.cleanup,
                  validate: options.cleanupValidate || options.cleanup,
                  quality: options.cleanupQuality || options.cleanup,
                  requiredFields: options.requiredFields?.split(',').map((f: string) => f.trim()),
                  validateFileFields: options.validateFileFields
                    ?.split(',')
                    .map((f: string) => f.trim()),
                  qualityThreshold: parseInt(String(options.qualityThreshold), 10),
                  minLength: options.minLength
                    ? parseInt(String(options.minLength), 10)
                    : undefined,
                  maxLength: options.maxLength
                    ? parseInt(String(options.maxLength), 10)
                    : undefined,
                  removeEmpty: options.removeEmpty,
                  basePath: options.basePath || path.dirname(options.input),
                }
              : undefined;

          // Parse role map if provided
          let roleMap: { system?: string; user?: string; assistant?: string } | undefined;
          if (options.roleMap) {
            try {
              roleMap = JSON.parse(options.roleMap);
            } catch {
              if (!isJsonMode()) {
                console.error(chalk.red('Error: --role-map must be valid JSON'));
              }
              exitWithCode(ExitCode.INVALID_INPUT, '--role-map must be valid JSON');
            }
            if (roleMap) {
              validateStringMap(roleMap as Record<string, unknown>, '--role-map');
            }
          }

          // Build options
          const formatOptions: ExtendedFormatOptions = {
            inputPath: options.input,
            outputDir,
            formatter: options.format,
            fieldMap,
            splitRatios,
            seed: parseInt(String(options.seed), 10),
            systemPrompt: options.systemPrompt,
            datasetName:
              options.datasetName || path.basename(options.input, path.extname(options.input)),
            imageField: options.imageField,
            audioField: options.audioField,
            copyMedia: options.copyMedia,
            generateCard: options.generateCard,
            basePath: options.basePath || path.dirname(path.resolve(options.input)),
            cleanup: cleanupOptions,
            // Formatter-specific options
            conversationIdField: options.conversationIdField,
            roleMap,
            includeSystem:
              options.includeSystem !== undefined ? options.includeSystem !== 'false' : undefined,
            conversationField: options.conversationField,
            humanField: options.humanField,
            assistantField: options.assistantField,
            treeIdField: options.treeIdField,
            parentIdField: options.parentIdField,
            lang: options.lang,
            includeEmptyInput:
              options.includeEmptyInput !== undefined
                ? options.includeEmptyInput !== 'false'
                : undefined,
            defaultInput: options.defaultInput,
            // Vision formatter options
            imageToken: options.imageToken,
            embedImages: options.embedImages || undefined,
            maxEmbedSize: options.maxEmbedSize
              ? parseInt(String(options.maxEmbedSize), 10)
              : undefined,
            classField: options.classField,
            imageExtensions: options.imageExtensions
              ? options.imageExtensions.split(',').map((e: string) => {
                  const ext = e.trim();
                  return ext.startsWith('.') ? ext : `.${ext}`;
                })
              : undefined,
            maskField: options.maskField,
            bboxField: options.bboxField,
            categoryIdField: options.categoryIdField,
            categoryNameField: options.categoryNameField,
            imageWidth: options.imageWidth ? parseInt(String(options.imageWidth), 10) : undefined,
            imageHeight: options.imageHeight
              ? parseInt(String(options.imageHeight), 10)
              : undefined,
            // Audio formatter options
            audioExtensions: options.audioExtensions
              ? options.audioExtensions.split(',').map((e: string) => {
                  const ext = e.trim();
                  return ext.startsWith('.') ? ext : `.${ext}`;
                })
              : undefined,
            textField: options.textField,
            durationField: options.durationField,
            extractDuration: options.extractDuration || undefined,
            // HuggingFace formatter options
            outputFormat: options.outputFormat,
            features: options.features
              ? (safeJsonParse(options.features, '--features option') as Record<string, any>)
              : undefined,
            stratifiedField: options.stratifiedField,
            // Dataset card metadata
            cardLicense: options.license,
            cardTaskCategories: options.taskCategories
              ? options.taskCategories.split(',').map((s: string) => s.trim())
              : undefined,
            cardLanguage: options.cardLanguage
              ? options.cardLanguage.split(',').map((s: string) => s.trim())
              : undefined,
            cardDescription: options.cardDescription,
          };

          // Run formatting
          const formatSpinner = new ProgressSpinner(`Formatting as ${options.format}...`);
          const startTime = Date.now();
          formatSpinner.start();
          const result = await formatDataset(formatOptions);
          formatSpinner.stop(true);
          const formatDuration = Date.now() - startTime;

          // Update task status
          await updateTaskStatus(taskId, 'completed', './output');

          // Print results
          if (!isJsonMode()) {
            console.log(chalk.green('\\n✓ Formatting complete!'));

            // Show cleanup stats if cleanup was performed
            if (cleanupOptions) {
              console.log(chalk.cyan('\\n  Cleanup enabled'));
            }

            console.log(chalk.gray(`  Output directory: ${result.outputDir}`));
            console.log(chalk.gray(`  Total records: ${result.metadata.counts.total}`));
            if (result.metadata.counts.train > 0) {
              console.log(chalk.gray(`    - Train: ${result.metadata.counts.train}`));
            }
            if (result.metadata.counts.validation > 0) {
              console.log(chalk.gray(`    - Validation: ${result.metadata.counts.validation}`));
            }
            if (result.metadata.counts.test > 0) {
              console.log(chalk.gray(`    - Test: ${result.metadata.counts.test}`));
            }
            const avgMs =
              result.metadata.counts.total > 0 ? formatDuration / result.metadata.counts.total : 0;
            console.log(
              chalk.gray(
                `  Duration: ${(formatDuration / 1000).toFixed(1)}s (avg ${Math.round(avgMs)}ms/record)`
              )
            );
          }

          outputResult(
            'format',
            {
              format: options.format,
              outputDir: result.outputDir,
              total: result.metadata.counts.total,
              train: result.metadata.counts.train,
              validation: result.metadata.counts.validation,
              test: result.metadata.counts.test,
              taskId,
            },
            { duration_ms: formatDuration }
          );
        } catch (error) {
          if (!isJsonMode()) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
            if (error instanceof Error && error.stack) {
              console.error(chalk.gray('Stack trace:'));
              console.error(error.stack);
            }
          }
          const message = error instanceof Error ? error.message : String(error);
          // CLIError from safeJsonParse already has proper exit code
          if (error instanceof Error && 'exitCode' in error) {
            exitWithCode((error as any).exitCode, message);
          } else if (message.includes('ENOENT') || message.includes('not found')) {
            exitWithCode(ExitCode.INVALID_INPUT, message);
          } else {
            exitWithCode(ExitCode.GENERAL_ERROR, message);
          }
        }
      })
    );

  return command;
}

/**
 * Validate that a parsed JSON value is a plain object with string keys and string values.
 * Rejects nested objects, arrays, and non-string values with a descriptive CLIError.
 */
function validateStringMap(obj: Record<string, unknown>, optionName: string): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      `${optionName} must be a plain JSON object with string keys and string values, got ${Array.isArray(obj) ? 'array' : typeof obj}`,
      ExitCode.INVALID_INPUT
    );
  }
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'string') {
      const valueType = Array.isArray(value) ? 'array' : typeof value;
      throw new CLIError(
        ErrorCodes.INVALID_INPUT,
        `${optionName} must have string values only, but key "${key}" has type "${valueType}". Nested objects and arrays are not allowed.`,
        ExitCode.INVALID_INPUT
      );
    }
  }
}

/**
 * Format help definitions for each formatter
 */
const formatHelpInfo: Record<
  string,
  { category: string; fields: string[]; options: string[]; example: string }
> = {
  alpaca: {
    category: 'Text/LLM',
    fields: ['instruction (required)', 'input (optional)', 'output (required)'],
    options: [
      '--include-empty-input <bool>  Include empty input field (default: true)',
      '--default-input <text>        Default value for empty input fields',
      '--system-prompt <text>        Prefix to instruction field',
    ],
    example:
      'npm start -- format -i data.json -f alpaca -o output/ --field-map \'{"q": "instruction", "a": "output"}\'',
  },
  chatml: {
    category: 'Text/LLM',
    fields: ['messages[] with role + content (system/user/assistant)'],
    options: [
      '--conversation-id-field <f>   Group flat records into multi-turn conversations',
      '--role-map <json>             Map custom fields to roles, e.g. \'{"user":"question","assistant":"answer"}\'',
      '--include-system <bool>       Include system message (default: true)',
      '--system-prompt <text>        System prompt text',
    ],
    example:
      'npm start -- format -i data.json -f chatml -o output/ --conversation-id-field conv_id',
  },
  sharegpt: {
    category: 'Text/LLM',
    fields: ['conversations[] with from + value (human/gpt/system)'],
    options: [
      '--conversation-field <field>  Group records into conversations by field',
      '--human-field <field>         Custom field name for human messages',
      '--assistant-field <field>     Custom field name for assistant messages',
      '--system-prompt <text>        System prompt text',
    ],
    example:
      'npm start -- format -i data.json -f sharegpt -o output/ --human-field question --assistant-field answer',
  },
  oasst: {
    category: 'Text/LLM',
    fields: ['message_id, parent_id, text, role, lang, message_tree_id'],
    options: [
      '--tree-id-field <field>       Field containing message tree ID',
      '--parent-id-field <field>     Field containing parent message ID',
      '--lang <code>                 Language code for all messages (e.g. "en")',
      '--system-prompt <text>        System prompt as root prompter message',
    ],
    example: 'npm start -- format -i data.json -f oasst -o output/ --lang en',
  },
  raw: {
    category: 'Text/LLM',
    fields: ['prompt (required)', 'completion (required)'],
    options: ['--system-prompt <text>        Prefix to prompt field'],
    example: 'npm start -- format -i data.json -f raw -o output/ --no-split',
  },
  llava: {
    category: 'Vision',
    fields: ['image (required)', 'conversations[] with from + value'],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--image-token <token>         Image placeholder token (default: "<image>")',
      '--embed-images                Embed images as base64 in output',
      '--max-embed-size <bytes>      Maximum image size for base64 embedding',
      '--copy-media                  Copy image files to output directory',
    ],
    example: 'npm start -- format -i data.json -f llava -o output/ --copy-media',
  },
  imagefolder: {
    category: 'Vision',
    fields: ['image path (required)', 'class/category label (required)'],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--class-field <field>         Field containing class/category label',
      '--image-extensions <exts>     Comma-separated allowed extensions (e.g. ".jpg,.png")',
      '--copy-media                  Copy image files to class folders',
    ],
    example:
      'npm start -- format -i data.json -f imagefolder -o output/ --class-field label --copy-media',
  },
  'csv-images': {
    category: 'Vision',
    fields: ['image path (required)', 'metadata fields'],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--copy-media                  Copy image files to output/images/',
    ],
    example: 'npm start -- format -i data.json -f csv-images -o output/ --copy-media',
  },
  coco: {
    category: 'Vision',
    fields: ['image path (required)', 'bbox [x, y, w, h]', 'category name/id'],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--bbox-field <field>          Field containing bounding boxes [x, y, w, h]',
      '--category-id-field <field>   Field containing category ID',
      '--category-name-field <field> Field containing category name',
      '--copy-media                  Copy image files to output directory',
    ],
    example:
      'npm start -- format -i data.json -f coco -o output/ --bbox-field bbox --category-name-field label',
  },
  yolo: {
    category: 'Vision',
    fields: ['image path (required)', 'bbox', 'class index/name'],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--bbox-field <field>          Field containing bounding boxes',
      '--class-field <field>         Field containing class index or name',
      '--image-width <pixels>        Image width for bbox normalization',
      '--image-height <pixels>       Image height for bbox normalization',
      '--copy-media                  Copy image files to images/ directory',
    ],
    example:
      'npm start -- format -i data.json -f yolo -o output/ --class-field class --bbox-field bbox',
  },
  'coco-seg': {
    category: 'Vision',
    fields: [
      'image path (required)',
      'mask file path (required)',
      'category name',
      'bbox [x, y, w, h]',
    ],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--mask-field <field>          Field containing mask file paths (default: "mask_path")',
      '--bbox-field <field>          Field containing bounding boxes [x, y, w, h]',
      '--category-name-field <field> Field containing category name',
      '--copy-media                  Copy images and masks to output directory',
    ],
    example:
      'npm start -- format -i segmentation.json -f coco-seg -o output/ --mask-field mask_path --copy-media',
  },
  'yolo-seg': {
    category: 'Vision',
    fields: ['image path (required)', 'mask file path (required)', 'class name (required)'],
    options: [
      '--image-field <field>         Field containing image paths (default: "image")',
      '--mask-field <field>          Field containing mask file paths (default: "mask_path")',
      '--class-field <field>         Field containing class/category label',
      '--copy-media                  Copy image files to images/ directory',
    ],
    example:
      'npm start -- format -i segmentation.json -f yolo-seg -o output/ --class-field category --mask-field mask_path',
  },
  audiofolder: {
    category: 'Audio',
    fields: ['audio path (required)', 'class/category label (required)'],
    options: [
      '--audio-field <field>         Field containing audio paths (default: "audio")',
      '--class-field <field>         Field containing class/category label',
      '--audio-extensions <exts>     Comma-separated allowed extensions (e.g. ".wav,.mp3,.flac")',
      '--copy-media                  Copy audio files to class folders',
    ],
    example:
      'npm start -- format -i data.json -f audiofolder -o output/ --class-field label --audio-field audio --copy-media',
  },
  'speech-text': {
    category: 'Audio',
    fields: ['audio path (required)', 'transcription text (required)', 'duration (optional)'],
    options: [
      '--audio-field <field>         Field containing audio paths (default: "audio")',
      '--text-field <field>          Field containing transcription text (default: "text")',
      '--duration-field <field>      Field containing pre-existing duration value',
      '--extract-duration            Use ffprobe to extract audio duration',
      '--audio-extensions <exts>     Comma-separated allowed extensions (e.g. ".wav,.mp3,.flac")',
      '--copy-media                  Copy audio files to output/audio/',
    ],
    example:
      'npm start -- format -i data.json -f speech-text -o output/ --audio-field audio --text-field text',
  },
  datasetdict: {
    category: 'HuggingFace',
    fields: ['any fields (schema auto-inferred)'],
    options: [
      '--output-format <format>      Output format: json (default) or parquet',
      '--features <json>             HF features schema as JSON (auto-inferred if not provided)',
      '--stratified-field <field>    Field for stratified splitting (maintain class distribution)',
      '--generate-card               Generate HuggingFace dataset card (README.md)',
      '--license <id>                License identifier (e.g., "mit", "apache-2.0")',
      '--task-categories <list>      Comma-separated task categories',
      '--card-language <list>        Comma-separated language codes (e.g., "en,es")',
      '--card-description <text>     Description text for dataset card',
    ],
    example:
      'npm start -- format -i data.json -f datasetdict -o output/hf --split 80:10:10 --generate-card',
  },
  parquet: {
    category: 'HuggingFace',
    fields: ['any fields (schema auto-inferred)'],
    options: [
      '--features <json>             HF features schema as JSON (auto-inferred if not provided)',
      '--stratified-field <field>    Field for stratified splitting (maintain class distribution)',
      '--generate-card               Generate HuggingFace dataset card (README.md)',
      '--license <id>                License identifier (e.g., "mit", "apache-2.0")',
      '--task-categories <list>      Comma-separated task categories',
      '--card-language <list>        Comma-separated language codes (e.g., "en,es")',
      '--card-description <text>     Description text for dataset card',
    ],
    example:
      'npm start -- format -i data.json -f parquet -o output/pq --split 80:10:10 --generate-card',
  },
};

/**
 * Print detailed help for a specific formatter
 */
function printFormatHelp(formatName: string): void {
  if (isJsonMode()) return;

  const info = formatHelpInfo[formatName];

  if (!info) {
    console.error(chalk.red(`Unknown format: "${formatName}"`));
    console.log(chalk.yellow('Use --list-formats to see available formats'));
    return;
  }

  console.log(chalk.cyan.bold(`\n  ${formatName}`) + chalk.gray(` (${info.category})`));
  console.log();

  console.log(chalk.white.bold('  Fields:'));
  for (const field of info.fields) {
    console.log(chalk.gray(`    - ${field}`));
  }
  console.log();

  console.log(chalk.white.bold('  Options:'));
  for (const opt of info.options) {
    console.log(chalk.gray(`    ${opt}`));
  }
  console.log();

  console.log(chalk.white.bold('  Common options:'));
  console.log(chalk.gray('    --field-map <json>           Map input fields to format fields'));
  console.log(
    chalk.gray('    --split <ratios>             Train/val/test split (e.g. "80:10:10")')
  );
  console.log(chalk.gray('    --no-split                   Output all data to single file'));
  console.log(chalk.gray('    --cleanup                    Enable data cleanup pipeline'));
  console.log(chalk.gray('    --base-path <path>           Base path for resolving file paths'));
  console.log();

  console.log(chalk.white.bold('  Example:'));
  console.log(chalk.green(`    ${info.example}`));
  console.log();
}

/**
 * Format command instance
 */
export const formatCommand = createFormatCommand();
