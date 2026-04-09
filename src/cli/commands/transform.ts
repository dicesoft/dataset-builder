/**
 * Transform command - converts scraped data to structured records
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { outputResult, isJsonMode, getGlobalFlags, isYesMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import {
  transformDataset,
  writeTransformOutput,
  printTransformStats,
  listTemplates,
  TransformOptions,
  TransformProgress,
  setTransformAbort,
} from '../../transformer';
import { getCheckpointPath, hasCheckpoint, clearCheckpoint } from '../../transformer/checkpoint';
import { getConfig } from '../../config';
import { getOllama } from '../../generators/ollama';
import { ProgressTracker } from '../../utils/tui';
import { syncOllamaServer, autoTuneConcurrency, warmupModels } from '../../utils/ollamaServer';
import fs from 'fs/promises';
import { generateTaskId, createTaskStructure } from '../../utils/taskManager';
import { deriveTaskDirFromInput } from '../../utils/taskDir';

/**
 * Create transform command
 */
export function createTransformCommand(): Command {
  const command = new Command('transform')
    .description('Transform scraped data or assets into formatter-ready structured records')
    .option(
      '-i, --input <path>',
      'Input file or directory (manifest.json, scraped_combined.json, or task folder)'
    )
    .option(
      '-t, --template <name>',
      'Transform template (text-qa, text-instruct, image-classification, etc.)'
    )
    .option('-o, --output <path>', 'Output file path (.json or .jsonl)')
    .option('-m, --model <model>', 'LLM/Vision model to use')
    .option('--target <topic>', 'Target topic for relevance scoring')
    .option('--relevance-threshold <0-1>', 'Minimum relevance score to keep', '0.5')
    .option('--batch-size <n>', 'LLM batch size', '10')
    .option('--min-text-length <n>', 'Minimum text length to process', '50')
    .option('--max-text-length <n>', 'Maximum text length to process', '10000')
    .option('--no-llm', 'Use deterministic only, skip LLM/Vision calls')
    .option('--dedupe', 'Deduplicate output', false)
    .option('--list-templates', 'List available templates')
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .option('--resume', 'Resume from checkpoint if transform was interrupted', false)
    .option('--force', 'Force overwrite existing checkpoint and start fresh', false)
    .option('--no-fallback', 'Never use deterministic fallback — skip failed records', false)
    .option('--retries <n>', 'Retries per LLM/vision call before skipping (default: 3)', '3')
    .option('--no-think', 'Disable VLLM thinking mode for faster output', false)
    .option('--no-log', 'Disable transform decision log output', false)
    .option('--ollama-concurrency <n>', 'Concurrent Ollama text requests (default: 4)')
    .option('--vision-concurrency <n>', 'Concurrent Ollama vision requests (default: 2)')
    .option('--classify-model <model>', 'Model for relevance scoring (fast model recommended)')
    .option('--generate-model <model>', 'Model for content generation')
    .option(
      '--ollama-instances <urls>',
      'Comma-separated Ollama server URLs for distributed processing'
    )
    .option('--auto-tune', 'Auto-detect optimal concurrency from available VRAM', false)
    .option(
      '--labels <list>',
      'Comma-separated labels to constrain classification (e.g., "cat,dog,bird")'
    )
    .option('--labels-file <path>', 'File containing labels (one per line or comma-separated)')
    .option(
      '--auto-labels',
      'Auto-discover labels from a sample of images before classification',
      false
    )
    .option(
      '--auto-labels-count <n>',
      'Number of images to sample for auto-label discovery (default: 20)',
      '20'
    )
    .option('--verbose', 'Enable verbose logging for detailed pipeline output', false)
    .action(
      wrapAction('transform', async (options) => {
        try {
          // Handle --list-templates
          if (options.listTemplates) {
            const templates = listTemplates();
            if (isJsonMode()) {
              outputResult('transform', { templates });
              return;
            }
            console.log(chalk.cyan('\nAvailable templates:'));
            for (const { name, description } of templates) {
              console.log(`  ${chalk.bold(name.padEnd(20))} - ${description}`);
            }
            console.log();
            console.log(chalk.gray('Text templates:'));
            console.log('  raw-extract, text-instruct, text-qa, text-conversation');
            console.log(chalk.gray('Image/Vision templates:'));
            console.log('  image-classification, image-captioning, vision-qa');
            console.log(chalk.gray('CV/Detection templates:'));
            console.log('  object-detection, segmentation');
            console.log(chalk.gray('Audio templates:'));
            console.log('  audio-classification');
            console.log();
            return;
          }

          // Validate required options
          if (!options.input) {
            if (!isJsonMode()) {
              console.error(chalk.red('Error: --input is required'));
              console.error(chalk.yellow('Use --list-templates to see available templates'));
            }
            exitWithCode(ExitCode.INVALID_INPUT, '--input is required');
          }

          if (!options.template) {
            if (!isJsonMode()) {
              console.error(chalk.red('Error: --template is required'));
              console.error(chalk.yellow('Use --list-templates to see available templates'));
            }
            exitWithCode(ExitCode.INVALID_INPUT, '--template is required');
          }

          // Validate mutually exclusive flags
          if (options.noFallback && options.llm === false) {
            if (!isJsonMode()) {
              console.error(chalk.red('Error: --no-fallback and --no-llm are mutually exclusive'));
            }
            exitWithCode(
              ExitCode.INVALID_INPUT,
              '--no-fallback and --no-llm are mutually exclusive'
            );
          }

          // Validate --auto-labels + --no-llm incompatibility
          if (options.autoLabels && options.llm === false) {
            if (!isJsonMode()) {
              console.error(
                chalk.red(
                  'Error: --auto-labels requires LLM calls and cannot be used with --no-llm'
                )
              );
            }
            exitWithCode(
              ExitCode.INVALID_INPUT,
              '--auto-labels requires LLM calls and cannot be used with --no-llm'
            );
          }

          // Validate --labels and --auto-labels mutual exclusivity
          if ((options.labels || options.labelsFile) && options.autoLabels) {
            if (!isJsonMode()) {
              console.error(
                chalk.red('Error: --labels/--labels-file and --auto-labels are mutually exclusive')
              );
            }
            exitWithCode(
              ExitCode.INVALID_INPUT,
              '--labels/--labels-file and --auto-labels are mutually exclusive'
            );
          }

          // Parse labels from --labels or --labels-file
          let parsedLabels: string[] | undefined;
          if (options.labels) {
            const labels = options.labels
              .split(',')
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 0);
            if (labels.length === 0) {
              if (!isJsonMode()) {
                console.error(chalk.red('Error: --labels must contain at least one label'));
              }
              exitWithCode(ExitCode.INVALID_INPUT, '--labels must contain at least one label');
            }
            if (labels.length === 1 && !isJsonMode()) {
              console.warn(
                chalk.yellow(
                  `  Warning: Only one label provided ("${labels[0]}"). All images will be assigned this label.`
                )
              );
            }
            parsedLabels = labels;
          } else if (options.labelsFile) {
            const labelsFilePath = path.resolve(options.labelsFile);
            try {
              const content = await fs.readFile(labelsFilePath, 'utf-8');
              const labels = content
                .split(/[\n,]/)
                .map((l: string) => l.trim())
                .filter((l: string) => l.length > 0);
              if (labels.length === 0) {
                if (!isJsonMode()) {
                  console.error(
                    chalk.red(`Error: Labels file "${labelsFilePath}" contains no valid labels`)
                  );
                }
                exitWithCode(
                  ExitCode.INVALID_INPUT,
                  `Labels file "${labelsFilePath}" contains no valid labels`
                );
              }
              parsedLabels = labels;
            } catch (err) {
              if (!isJsonMode()) {
                console.error(
                  chalk.red(`Error: Could not read labels file "${labelsFilePath}": ${err}`)
                );
              }
              exitWithCode(
                ExitCode.INVALID_INPUT,
                `Could not read labels file "${labelsFilePath}"`
              );
            }
          }

          // Handle --dry-run early
          if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
            const planned_actions: string[] = [];
            planned_actions.push(`Input: ${path.resolve(options.input)}`);
            planned_actions.push(`Template: ${options.template}`);
            if (options.output) planned_actions.push(`Output: ${path.resolve(options.output)}`);
            if (options.target) planned_actions.push(`Target topic: ${options.target}`);
            planned_actions.push(
              `LLM: ${options.llm === false ? 'disabled (deterministic)' : 'enabled'}`
            );
            if (options.model) planned_actions.push(`Model: ${options.model}`);
            planned_actions.push(`Batch size: ${options.batchSize}`);
            planned_actions.push(`Relevance threshold: ${options.relevanceThreshold}`);

            outputResult('transform', {
              dry_run: true,
              command: 'transform',
              planned_actions,
              estimated: {
                input: path.resolve(options.input),
                template: options.template,
              },
            });
            if (!isJsonMode()) {
              console.log(chalk.yellow('Dry run - no transformation will be performed.'));
              for (const action of planned_actions) {
                console.log(chalk.gray(`  - ${action}`));
              }
            }
            return;
          }

          const config = getConfig();
          const model = options.model || config.get('ollamaModel');

          // Apply multi-model config overrides
          if (options.classifyModel) config.set('ollamaClassifyModel', options.classifyModel);
          if (options.generateModel) config.set('ollamaGenerateModel', options.generateModel);

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

          // Apply concurrency overrides and auto-sync Ollama if needed
          const ollamaConcurrency = options.ollamaConcurrency
            ? parseInt(options.ollamaConcurrency, 10)
            : undefined;
          const visionConcurrency = options.visionConcurrency
            ? parseInt(options.visionConcurrency, 10)
            : undefined;
          if (ollamaConcurrency) config.set('ollamaConcurrency', ollamaConcurrency);
          if (visionConcurrency) config.set('ollamaVisionConcurrency', visionConcurrency);

          // Sync Ollama server with parallel config (now default concurrency > 1)
          await syncOllamaServer({ ollamaConcurrency, ollamaVisionConcurrency: visionConcurrency });

          // Resolve output path first for checkpoint checking
          let outputPath = options.output ? path.resolve(options.output) : undefined;
          if (!outputPath) {
            // Derive output path from input path
            const inputPath = path.resolve(options.input);

            let taskDir: string;
            try {
              // Shared helper (master-plan §3.5): directory → itself,
              // file → dirname. Throws on missing input.
              taskDir = await deriveTaskDirFromInput(inputPath);
            } catch {
              // Input doesn't exist - fall back to creating a new task folder
              const taskId = generateTaskId();
              taskDir = path.join('./output', taskId);
              await createTaskStructure(taskId, [], './output');
            }

            // Create transform subdirectory if it doesn't exist
            const transformDir = path.join(taskDir, 'transform');
            await fs.mkdir(transformDir, { recursive: true });
            outputPath = path.join(transformDir, 'transformed.json');
          }

          // Check for existing checkpoint
          const checkpointExists = await hasCheckpoint(outputPath);
          if (checkpointExists) {
            if (options.force) {
              if (!isJsonMode()) {
                console.log(
                  chalk.yellow(
                    '  Found existing checkpoint. --force flag set, clearing checkpoint...'
                  )
                );
              }
              await clearCheckpoint(outputPath);
            } else if (!options.resume) {
              if (!isJsonMode()) {
                console.log(
                  chalk.yellow(
                    `  Found existing checkpoint. Use --resume to continue or --force to start fresh.`
                  )
                );
                console.log(chalk.gray(`  Checkpoint: ${getCheckpointPath(outputPath)}`));
              }
            }
          }

          // Ensure output path is defined
          if (!outputPath) {
            throw new Error('Failed to resolve output path');
          }

          // Build transform options
          const inputResolved = path.resolve(options.input);
          // assetDir is the task directory — shared helper keeps the
          // "directory → itself, file → dirname" rule identical to the
          // output-path derivation above (master-plan §3.5).
          const assetDir = await deriveTaskDirFromInput(inputResolved);
          const transformOptions: TransformOptions = {
            input: inputResolved,
            template: options.template,
            output: outputPath,
            model,
            target: options.target,
            assetDir,
            relevanceThreshold: parseFloat(options.relevanceThreshold),
            batchSize: parseInt(options.batchSize, 10),
            minTextLength: parseInt(options.minTextLength, 10),
            maxTextLength: parseInt(options.maxTextLength, 10),
            noLlm: options.llm === false,
            explicitModel: !!options.model,
            dedupe: options.dedupe,
            yes: options.yes,
            resume: options.resume,
            force: options.force,
            noFallback: options.noFallback || false,
            retries: parseInt(options.retries, 10),
            noThink: options.noThink || false,
            verbose: options.verbose || process.env.VERBOSE === 'true',
            log: options.log !== false,
            labels: parsedLabels,
            autoLabels: options.autoLabels || false,
            autoLabelsCount: parseInt(options.autoLabelsCount, 10) || 20,
          };

          if (transformOptions.verbose) process.env.VERBOSE = 'true';

          // Pre-warm models if not in no-llm mode
          if (transformOptions.noLlm !== true) {
            const modelsToWarm = [model];
            const classifyModel = config.get('ollamaClassifyModel');
            const generateModel = config.get('ollamaGenerateModel');
            if (classifyModel) modelsToWarm.push(classifyModel);
            if (generateModel) modelsToWarm.push(generateModel);
            await warmupModels(modelsToWarm);
          }

          if (!isJsonMode()) {
            console.log(chalk.cyan('Transforming dataset...'));
            console.log(chalk.gray(`  Input: ${transformOptions.input}`));
            console.log(chalk.gray(`  Template: ${transformOptions.template}`));
            console.log(chalk.gray(`  Output: ${transformOptions.output}`));
            if (transformOptions.target) {
              console.log(chalk.gray(`  Target: ${transformOptions.target}`));
            }
            if (transformOptions.labels && transformOptions.labels.length > 0) {
              console.log(chalk.gray(`  Labels: ${transformOptions.labels.join(', ')}`));
            }
            if (transformOptions.autoLabels) {
              console.log(
                chalk.gray(
                  `  Auto-labels: enabled (sampling ${transformOptions.autoLabelsCount} images)`
                )
              );
            }
            if (transformOptions.noLlm) {
              console.log(chalk.yellow('  Mode: Deterministic (no LLM calls)'));
            } else {
              console.log(chalk.gray(`  Model: ${model}`));
            }
          }

          // Set up progress tracker
          const tracker = new ProgressTracker('Transform');
          let trackerStarted = false;

          // Set up abort handler
          let abortRequested = false;
          let forceQuit = false;
          const sigintHandler = () => {
            if (abortRequested) {
              forceQuit = true;
              if (!isJsonMode()) {
                console.log(chalk.red('\nForce quit after save...'));
              }
              return;
            }
            if (!isJsonMode()) {
              console.log(
                chalk.yellow('\nAborting... saving checkpoint (Ctrl+C again to force quit)')
              );
            }
            abortRequested = true;
            setTransformAbort(true);
            // Cancel in-flight Ollama requests immediately
            try {
              getOllama().abortAll();
            } catch {
              /* not initialized */
            }
            // Stop TUI immediately
            if (trackerStarted) {
              tracker.stop();
              trackerStarted = false;
            }
          };
          process.on('SIGINT', sigintHandler);

          // Progress callback with generation timing
          let generationStartTime: number | undefined;
          let lastCompleted = 0;

          const progressCallback = (progress: TransformProgress) => {
            if (!trackerStarted) {
              tracker.start(progress.total || undefined);
              trackerStarted = true;
            }

            // Track when generation/vision stage starts
            if (
              !generationStartTime &&
              (progress.stage === 'generation' || progress.stage === 'vision')
            ) {
              generationStartTime = Date.now();
            }

            lastCompleted = progress.completed;
            tracker.setPhase(progress.stage);
            tracker.setMessage(progress.message);
            tracker.update(progress.completed);
            tracker.setCounters({ records: progress.completed });
          };

          // Ensure output is defined before transform
          if (!transformOptions.output) {
            throw new Error('Output path is required');
          }

          // Run transform
          const result = await transformDataset(transformOptions, progressCallback);

          // Compute generation timing
          if (generationStartTime && result.stats.generatedCount > 0) {
            result.stats.generationDuration = Date.now() - generationStartTime;
            result.stats.avgRecordDuration =
              result.stats.generationDuration / result.stats.generatedCount;
          }

          // Only show complete if not already stopped by abort handler
          if (trackerStarted && !abortRequested) {
            tracker.complete(
              `${result.stats.outputCount} records output from ${result.stats.inputCount} input`
            );
          }
          process.removeListener('SIGINT', sigintHandler);

          // Write output (output is guaranteed to be defined here)
          const finalOutputPath = transformOptions.output!;
          await writeTransformOutput(result, finalOutputPath);

          // Verify output integrity — read back and compare record count
          try {
            const writtenData = await fs.readFile(finalOutputPath, 'utf-8');
            const writtenRecords = JSON.parse(writtenData);
            if (Array.isArray(writtenRecords) && writtenRecords.length !== result.records.length) {
              if (!isJsonMode()) {
                console.warn(
                  chalk.yellow(
                    `⚠ Output mismatch: expected ${result.records.length} records but file contains ${writtenRecords.length}`
                  )
                );
              }
            }
          } catch {
            if (!isJsonMode()) {
              console.warn(chalk.yellow('⚠ Could not verify output file integrity'));
            }
          }

          // Print stats
          printTransformStats(result.stats);

          if (!isJsonMode()) {
            if (result.stats.abortedEarly) {
              console.log(chalk.yellow('\n⚠ Transform interrupted. Progress saved.'));
              console.log(chalk.yellow('  Run with --resume to continue from checkpoint.'));
            } else if (
              result.stats.generationFailedCount &&
              result.stats.generationFailedCount > result.stats.generatedCount * 0.5
            ) {
              console.log(chalk.yellow('\n⚠ Transform complete with quality warnings'));
            } else {
              console.log(chalk.green('\n✓ Transform complete!'));
            }
            console.log(chalk.gray(`  Output: ${finalOutputPath}`));
          }

          // Build JSON output envelope with transparency fields
          const jsonOutput: Record<string, unknown> = {
            inputCount: result.stats.inputCount,
            outputCount: result.stats.outputCount,
            template: options.template,
            outputFile: finalOutputPath,
            aborted: result.stats.abortedEarly || false,
          };

          // Include discovered_labels when auto-labels was used
          if (result.discoveredLabels && result.discoveredLabels.length > 0) {
            jsonOutput.discovered_labels = result.discoveredLabels;
          }

          // Task 2.1: Include drop_reasons in JSON output
          if (result.stats.dropReasons) {
            jsonOutput.drop_reasons = result.stats.dropReasons;
          }

          // Include fallback_reasons in JSON output
          if (result.stats.fallbackReasons) {
            jsonOutput.fallback_reasons = result.stats.fallbackReasons;
          }

          // Include format_breakdown in JSON output
          if (
            result.stats.formatBreakdown &&
            Object.keys(result.stats.formatBreakdown).length > 0
          ) {
            jsonOutput.format_breakdown = result.stats.formatBreakdown;
          }

          // Task 2.3: Include completed/failed breakdown in JSON output
          if (result.stats.completedInputCount !== undefined) {
            jsonOutput.completedInputCount = result.stats.completedInputCount;
          }
          if (result.stats.failedInputCount !== undefined) {
            jsonOutput.failedInputCount = result.stats.failedInputCount;
          }

          // Task 2.2: Add degraded flag and warnings array
          const warnings: string[] = [];
          const generatedCount = result.stats.generatedCount || 0;
          if (generatedCount > 0) {
            const visionFallbackRate = (result.stats.visionFallbackCount || 0) / generatedCount;
            const genFailedRate = (result.stats.generationFailedCount || 0) / generatedCount;

            if (visionFallbackRate > 0.5) {
              warnings.push(
                `High vision fallback rate: ${Math.round(visionFallbackRate * 100)}% of records used deterministic fallback instead of vision model`
              );
            }
            if (genFailedRate > 0.5) {
              warnings.push(
                `High generation failure rate: ${Math.round(genFailedRate * 100)}% of records fell back to deterministic generation`
              );
            }
          }
          if (result.stats.abortedEarly) {
            warnings.push('Processing was interrupted early. Use --resume to continue.');
          }

          if (warnings.length > 0) {
            jsonOutput.degraded = true;
            jsonOutput.warnings = warnings;
          }

          // Task 3.7: Include decision log path in JSON output
          if (result.decisionLogPath) {
            jsonOutput.decisionLogPath = result.decisionLogPath;
          }

          outputResult('transform', jsonOutput);

          // Also write JSONL if output was JSON
          if (finalOutputPath.endsWith('.json') && !isJsonMode()) {
            console.log(chalk.gray(`  JSONL: ${finalOutputPath.replace('.json', '.jsonl')}`));
          }

          // Show decision log path
          if (result.decisionLogPath && !isJsonMode()) {
            console.log(chalk.gray(`  Decision log: ${result.decisionLogPath}`));
          }

          // Exit after save if force quit was requested
          if (forceQuit) {
            exitWithCode(ExitCode.USER_ABORT, 'Transform interrupted by user');
          }
        } catch (error) {
          if (!isJsonMode()) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
            if (error instanceof Error && error.stack) {
              console.error(chalk.gray('Stack trace:'));
              console.error(error.stack);
            }
          }
          exitWithCode(
            ExitCode.GENERAL_ERROR,
            error instanceof Error ? error.message : String(error)
          );
        }
      })
    );

  return command;
}

/**
 * Transform command instance
 */
export const transformCommand = createTransformCommand();
