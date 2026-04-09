/**
 * Translate command - Translate datasets into multiple languages using LLM
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';
import { getConfig } from '../../config';
import { confirm } from '../../utils/confirm';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { getOllama } from '../../generators/ollama';
import { syncOllamaServer, autoTuneConcurrency, warmupModels } from '../../utils/ollamaServer';
import { importFile } from '../../importers';
import {
  resolveLanguage,
  isLanguageSupported,
  listSupportedLanguages,
  listRegisteredModels,
  translateDataset,
  setAbortFlag,
  createTranslationTUI,
  updateTranslationProgress,
  stopTranslationTUI,
  setTranslationAborting,
  printTranslationSummary,
} from '../../translator';
import type { LanguageInfo, TranslateOptions, TranslationResult } from '../../translator';
import {
  generateTaskId,
  createTaskStructure,
  createTaskMetadata,
  updateTaskStatus,
} from '../../utils/taskManager';
import {
  CommandCheckpoint,
  saveCommandCheckpoint,
  loadCommandCheckpoint,
  clearCommandCheckpoint,
  getCheckpointPath,
} from '../../utils/checkpoint';

export const translateCommand = new Command('translate')
  .description('Translate datasets into multiple languages using LLM')
  .option('-i, --input <path>', 'Input file path (JSON, JSONL, CSV)')
  .option('-l, --languages <langs...>', 'Target language codes or names')
  .option('-o, --output <path>', 'Output directory')
  .addOption(
    new Option('-f, --format <format>', 'Output format: json, jsonl, csv').choices([
      'json',
      'jsonl',
      'csv',
    ])
  )
  .option('-m, --model <model>', 'LLM model for translation')
  .option('--source-lang <lang>', 'Source language hint')
  .option('--batch-size <number>', 'Records per LLM call')
  .option('--fields <fields...>', 'Only translate these field names')
  .option('--exclude-fields <fields...>', 'Skip these field names')
  .option('--per-language', 'Separate file per language (default)', true)
  .option('--merged', 'Single merged file with _language field added')
  .option('--list-languages', 'List supported languages and exit')
  .option('--list-models', 'List registered models and exit')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .option('--ollama-concurrency <n>', 'Concurrent Ollama text requests (default: 4)')
  .option(
    '--ollama-instances <urls>',
    'Comma-separated Ollama server URLs for distributed processing'
  )
  .option('--auto-tune', 'Auto-detect optimal concurrency from available VRAM', false)
  .option('--resume <checkpoint-file>', 'Resume from a saved checkpoint file')
  .action(
    wrapAction('translate', async (options) => {
      // Handle info queries
      if (options.listLanguages) {
        const { isJsonMode } = await import('../../utils/output');
        if (isJsonMode()) {
          const languages = listSupportedLanguages(options.model);
          outputResult('translate', { languages });
          return;
        }
        printLanguageList(options.model);
        return;
      }

      if (options.listModels) {
        const { isJsonMode } = await import('../../utils/output');
        if (isJsonMode()) {
          const models = listRegisteredModels();
          outputResult('translate', { models });
          return;
        }
        printModelList();
        return;
      }

      // Validate required options
      if (!options.input) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: --input (-i) is required'));
        }
        exitWithCode(ExitCode.INVALID_INPUT, '--input (-i) is required');
      }
      if (!options.languages || options.languages.length === 0) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: --languages (-l) is required'));
        }
        exitWithCode(ExitCode.INVALID_INPUT, '--languages (-l) is required');
      }

      const config = getConfig();
      const model = options.model || config.get('translateModel') || 'gemini-3-flash-preview:cloud';
      const batchSize = options.batchSize
        ? parseInt(options.batchSize, 10)
        : config.get('translateBatchSize') || 5;
      const inputPath = path.resolve(options.input);
      const inputExt = path.extname(inputPath).toLowerCase().slice(1);

      // Resolve target languages (flatten comma-separated values like "es,fr")
      const langs = options.languages.flatMap((l: string) =>
        l
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      );
      const targetLanguages: LanguageInfo[] = [];
      for (const lang of langs) {
        const resolved = resolveLanguage(lang);
        if (!resolved) {
          if (!isJsonMode()) {
            console.error(chalk.red(`Error: Unknown language "${lang}".`));
            console.error(
              chalk.yellow('  Example valid codes: es, fr, de, ja, ko, zh, ar, hi, pt, ru')
            );
            console.error(chalk.yellow('  Example valid names: spanish, french, german, japanese'));
            console.error(chalk.yellow('  Run --list-languages to see all supported languages.'));
          }
          exitWithCode(ExitCode.INVALID_INPUT, `Unknown language "${lang}"`);
        }
        if (!isLanguageSupported(model, resolved.code)) {
          if (!isJsonMode()) {
            console.warn(
              chalk.yellow(
                `Warning: "${resolved.name}" may not be fully supported by model ${model}`
              )
            );
          }
        }
        targetLanguages.push(resolved);
      }

      // Parse multi-instance URLs
      if (options.ollamaInstances) {
        const urls = options.ollamaInstances.split(',').map((u: string) => u.trim());
        config.set(
          'ollamaInstances',
          urls.map((url: string) => ({ url }))
        );
      }

      // Auto-tune concurrency from VRAM if requested
      if (options.autoTune) {
        const vramInfo = await autoTuneConcurrency();
        if (!isJsonMode()) {
          console.log(
            chalk.blue(`Auto-tune: suggested concurrency = ${vramInfo.suggestedParallel}`)
          );
          if (vramInfo.warning) {
            console.log(chalk.yellow(`  Warning: ${vramInfo.warning}`));
          }
        }
        config.set('ollamaConcurrency', vramInfo.suggestedParallel);
      }

      // Apply concurrency override and auto-sync Ollama if needed
      const ollamaConcurrency = options.ollamaConcurrency
        ? parseInt(options.ollamaConcurrency, 10)
        : undefined;
      if (ollamaConcurrency) config.set('ollamaConcurrency', ollamaConcurrency);
      // Sync Ollama server with parallel config (now default concurrency > 1)
      await syncOllamaServer({ ollamaConcurrency });

      // Load input data
      if (!isJsonMode()) {
        console.log(chalk.blue('Loading input file...'));
      }
      let records: Record<string, unknown>[];
      try {
        const imported = await loadInputFile(inputPath, inputExt);
        records = imported as Record<string, unknown>[];
      } catch (error: any) {
        if (!isJsonMode()) {
          console.error(chalk.red(`Error loading input: ${error.message}`));
        }
        exitWithCode(ExitCode.INVALID_INPUT, `Error loading input: ${error.message}`);
      }

      if (records.length === 0) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: Input file contains no records'));
        }
        exitWithCode(ExitCode.INVALID_INPUT, 'Input file contains no records');
      }

      // Determine output format
      const outputFormat = options.format || inputExt || 'json';

      // Show translation plan
      const estimatedCalls = targetLanguages.length * Math.ceil(records.length / batchSize);

      if (!isJsonMode()) {
        console.log();
        console.log(chalk.cyan('\u2550'.repeat(60)));
        console.log(chalk.bold('  Translation Plan'));
        console.log(chalk.cyan('\u2550'.repeat(60)));
        console.log(`  Model:      ${chalk.bold(model)}`);
        console.log(`  Records:    ${chalk.bold(records.length.toString())}`);
        console.log(
          `  Languages:  ${chalk.bold(targetLanguages.map((l) => `${l.name} (${l.code})`).join(', '))}`
        );
        console.log(`  Batch size: ${chalk.bold(batchSize.toString())}`);
        console.log(`  API calls:  ~${chalk.bold(estimatedCalls.toString())}`);
        console.log(
          `  Output:     ${chalk.bold(options.merged ? 'merged' : 'per-language')} (${outputFormat})`
        );
        if (options.fields) {
          console.log(`  Fields:     ${chalk.bold(options.fields.join(', '))}`);
        }
        if (options.excludeFields) {
          console.log(`  Exclude:    ${chalk.bold(options.excludeFields.join(', '))}`);
        }
        console.log(chalk.cyan('\u2550'.repeat(60)));
        console.log();
      }

      // Handle --dry-run early
      if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
        outputResult('translate', {
          dry_run: true,
          command: 'translate',
          planned_actions: [
            `Input: ${inputPath} (${records.length} records)`,
            `Model: ${model}`,
            `Languages: ${targetLanguages.map((l) => `${l.name} (${l.code})`).join(', ')}`,
            `Batch size: ${batchSize}`,
            `Estimated API calls: ~${estimatedCalls}`,
            `Output format: ${options.merged ? 'merged' : 'per-language'} (${outputFormat})`,
          ],
          estimated: {
            records: records.length,
            languages: targetLanguages.length,
            api_calls: estimatedCalls,
          },
        });
        if (!isJsonMode()) {
          console.log(chalk.yellow('Dry run - no translation will be performed.'));
        }
        return;
      }

      // Confirmation prompt
      if (!options.yes) {
        const confirmed = await confirm('Proceed with translation?', true);
        if (!confirmed) {
          if (!isJsonMode()) {
            console.log(chalk.yellow('Translation cancelled.'));
          }
          return;
        }
      }

      // Pre-warm model
      await warmupModels([model]);

      // Verify Ollama connectivity
      if (!isJsonMode()) {
        console.log(chalk.blue('Connecting to Ollama...'));
      }
      const ollama = getOllama();
      const isReachable = await ollama.ping();
      if (!isReachable) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: Cannot connect to Ollama. Is it running?'));
          console.log(chalk.gray(`Configured URL: ${config.get('ollamaUrl')}`));
        }
        exitWithCode(ExitCode.OLLAMA_UNAVAILABLE, 'Cannot connect to Ollama. Is it running?');
      }
      if (!isJsonMode()) {
        console.log(chalk.green('Connected to Ollama'));
      }

      // Create task folder
      const taskId = generateTaskId();
      const outputDir = options.output || config.get('outputDir') || './output';
      const taskDir = await createTaskStructure(taskId, ['translated'], outputDir);
      await createTaskMetadata(
        taskId,
        `translate -i ${options.input} -l ${options.languages.join(' ')}`,
        outputDir,
        {
          model,
          inputFile: inputPath,
          recordCount: records.length,
          targetLanguages: targetLanguages.map((l) => l.code),
          batchSize,
          outputFormat,
        },
        'translate'
      );

      // ── Resume from checkpoint if requested ──
      let resumedResults: TranslationResult[] = [];
      const completedLangSet = new Set<string>();
      if (options.resume) {
        const cp = await loadCommandCheckpoint(path.resolve(options.resume));
        if (cp && cp.command === 'translate') {
          resumedResults = cp.partialResults as TranslationResult[];
          for (const r of resumedResults) completedLangSet.add(r.language.code);
          if (!isJsonMode()) {
            console.log(
              chalk.green(
                `Resuming from checkpoint – ${resumedResults.length} languages already completed`
              )
            );
          }
        } else {
          if (!isJsonMode()) {
            console.warn(
              chalk.yellow('Checkpoint file not found or incompatible – starting fresh')
            );
          }
        }
      }

      // Filter out already-completed languages when resuming
      const remainingLanguages = targetLanguages.filter((l) => !completedLangSet.has(l.code));

      // Determine a stable output path for the checkpoint file
      const translatedDir = path.join(taskDir, 'translated');
      const checkpointOutputRef = path.join(translatedDir, `translate-checkpoint-ref.json`);

      // Set up SIGINT handler with checkpoint save
      let translationResults: TranslationResult[] = [...resumedResults];
      const sigintHandler = async () => {
        setAbortFlag(true);
        setTranslationAborting(true);
        // Save checkpoint with whatever results we have so far
        const cp: CommandCheckpoint = {
          command: 'translate',
          outputPath: checkpointOutputRef,
          totalRecords: records.length * targetLanguages.length,
          completedIndices: translationResults.flatMap((r, li) =>
            r.records.map((_, ri) => li * records.length + ri)
          ),
          partialResults: translationResults,
          startedAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          meta: {
            model,
            inputPath,
            targetLanguages: targetLanguages.map((l) => l.code),
            completedLanguages: translationResults.map((r) => r.language.code),
          },
        };
        await saveCommandCheckpoint(cp);
        if (!isJsonMode()) {
          console.log(chalk.green(`\nCheckpoint saved: ${getCheckpointPath(checkpointOutputRef)}`));
        }
      };
      process.on('SIGINT', sigintHandler);

      // Run translation (only for remaining languages)
      const translateOptions: TranslateOptions = {
        model,
        targetLanguages: remainingLanguages,
        sourceLanguage: options.sourceLang,
        batchSize,
        fieldsToTranslate: options.fields,
        fieldsToExclude: options.excludeFields,
        temperature: 0.3,
        maxRetries: 3,
      };

      createTranslationTUI();
      let results: TranslationResult[];

      try {
        const newResults = await translateDataset(records, translateOptions, (progress) => {
          updateTranslationProgress(progress);
        });
        translationResults = [...resumedResults, ...newResults];
        results = translationResults;
      } catch (error: any) {
        stopTranslationTUI();
        if (!isJsonMode()) {
          console.error(chalk.red(`Translation error: ${error.message}`));
        }
        await updateTaskStatus(taskId, 'failed', outputDir);
        process.removeListener('SIGINT', sigintHandler);
        const translationMsg = `Translation error: ${error.message}`;
        if (
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('fetch failed') ||
          error.message.includes('Ollama')
        ) {
          exitWithCode(ExitCode.OLLAMA_UNAVAILABLE, translationMsg);
        } else {
          exitWithCode(ExitCode.GENERAL_ERROR, translationMsg);
        }
      }

      stopTranslationTUI();
      process.removeListener('SIGINT', sigintHandler);

      // Clear checkpoint on successful completion
      await clearCommandCheckpoint(checkpointOutputRef);

      if (options.merged) {
        // Single merged file with _language field
        const mergedRecords: Record<string, unknown>[] = [];
        for (const result of results) {
          for (const record of result.records) {
            mergedRecords.push({ ...record, _language: result.language.code });
          }
        }
        const outputPath = path.join(translatedDir, `merged.${outputFormat}`);
        await writeOutput(mergedRecords, outputPath, outputFormat);
        if (!isJsonMode()) {
          console.log(chalk.green(`  Merged output: ${outputPath}`));
        }
      } else {
        // Per-language files
        for (const result of results) {
          const filename = `${result.language.code}.${outputFormat}`;
          const outputPath = path.join(translatedDir, filename);
          await writeOutput(result.records, outputPath, outputFormat);
          if (!isJsonMode()) {
            console.log(chalk.green(`  ${result.language.name}: ${outputPath}`));
          }
        }
      }

      if (!isJsonMode()) {
        console.log();
      }
      await updateTaskStatus(taskId, 'completed', outputDir);

      // Print summary
      printTranslationSummary(results);
      if (!isJsonMode()) {
        console.log(chalk.gray(`  Task: ${taskId}`));
        console.log(chalk.gray(`  Output: ${translatedDir}`));
      }

      outputResult('translate', {
        taskId,
        languages: results.map((r) => r.language.code),
        recordsPerLanguage: results.map((r) => ({
          language: r.language.code,
          records: r.records.length,
        })),
        outputDir: translatedDir,
      });
    })
  );

/**
 * Load input file supporting JSON, JSONL, CSV, and other formats
 */
async function loadInputFile(filePath: string, ext: string): Promise<unknown[]> {
  if (ext === 'json') {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [data];
  }

  if (ext === 'jsonl') {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  // Use importer for CSV, XLS, XML, etc.
  return importFile({ filePath, type: ext === 'auto' ? 'auto' : ext });
}

/**
 * Write output in the specified format
 */
async function writeOutput(
  records: Record<string, unknown>[],
  outputPath: string,
  format: string
): Promise<void> {
  let content: string;

  switch (format) {
    case 'jsonl':
      content = records.map((r) => JSON.stringify(r)).join('\n');
      break;
    case 'csv':
      content = toCSV(records);
      break;
    case 'json':
    default:
      content = JSON.stringify(records, null, 2);
      break;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content, 'utf-8');
}

/**
 * Convert records to CSV string
 */
function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const keys = new Set<string>();
  data.forEach((item) => {
    Object.keys(item).forEach((k) => keys.add(k));
  });

  const headers = Array.from(keys);

  const rows = data.map((item) => {
    return headers
      .map((h) => {
        const value = item[h];
        const str = value === undefined || value === null ? '' : String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Print supported languages table
 */
function printLanguageList(modelId?: string): void {
  const languages = listSupportedLanguages(modelId);

  console.log(chalk.cyan('\u2550'.repeat(60)));
  console.log(chalk.bold('  Supported Languages'));
  if (modelId) console.log(chalk.gray(`  Model: ${modelId}`));
  console.log(chalk.cyan('\u2550'.repeat(60)));

  for (const lang of languages) {
    console.log(
      `  ${chalk.bold(lang.code.padEnd(5))} ${lang.name.padEnd(15)} ${chalk.gray(lang.nativeName)}`
    );
  }

  console.log(chalk.cyan('\u2550'.repeat(60)));
  console.log(chalk.gray(`  ${languages.length} languages available`));
}

/**
 * Print registered models table
 */
function printModelList(): void {
  const models = listRegisteredModels();

  console.log(chalk.cyan('\u2550'.repeat(60)));
  console.log(chalk.bold('  Registered Translation Models'));
  console.log(chalk.cyan('\u2550'.repeat(60)));

  for (const model of models) {
    console.log(`  ${chalk.bold(model.modelId)}`);
    console.log(`    Provider:  ${model.provider}`);
    console.log(`    Languages: ${model.languages.length}`);
    if (model.notes) console.log(`    Notes:     ${chalk.gray(model.notes)}`);
    console.log();
  }

  console.log(chalk.cyan('\u2550'.repeat(60)));
}
