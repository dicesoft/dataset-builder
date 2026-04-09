import { Command, Option } from 'commander';
import chalk from 'chalk';
import { cleanData } from '../../sanitizers/index';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { filterText, filterTexts } from '../../sanitizers/llmFilter';
import { verifyMath } from '../../sanitizers/mathVerifier';
import { factCheck } from '../../sanitizers/factCheck';
import { filterImages, filterImageDirectory, getImageFiles } from '../../sanitizers/visionFilter';
import { findDuplicateImages, removeDuplicateImages } from '../../sanitizers/imageDeduplication';
import { filterJunkImages } from '../../sanitizers/imageCleanup';
import { getConfig } from '../../config';
import { ProgressTracker } from '../../utils/tui';
import { syncOllamaServer, autoTuneConcurrency } from '../../utils/ollamaServer';
import { confirm } from '../../utils/confirm';
import { safeJsonParse, safeJsonlParse } from '../../utils/json';
import fs from 'fs/promises';
import path from 'path';
import type { ConfigLoader } from '../../config/loader';
import {
  CommandCheckpoint,
  saveCommandCheckpoint,
  loadCommandCheckpoint,
  clearCommandCheckpoint,
  getCheckpointPath,
} from '../../utils/checkpoint';

/** Typed options for the clean command */
interface CleanOptions {
  input: string;
  output?: string;
  dedupe: boolean;
  trim: boolean;
  lowercase: boolean;
  removeEmpty: boolean;
  normalizeNewlines: boolean;
  llmFilter: boolean;
  strictness: string;
  target?: string;
  batchSize: string;
  verifyMath: boolean;
  factCheck: boolean;
  visionFilter: boolean;
  visionTarget?: string | string[];
  checkNsfw: boolean;
  removeFailed: boolean;
  visionLimit?: string;
  visionModel?: string;
  visionPrompt?: string;
  verbose: boolean;
  visionSensitivity?: string;
  removeJunk: boolean;
  minSize?: string;
  minDimensions?: string;
  dedupeImages: boolean;
  dedupeImagesDryRun: boolean;
  yes: boolean;
  ollamaConcurrency?: string;
  visionConcurrency?: string;
  ollamaInstances?: string;
  autoTune: boolean;
  resume?: string;
}

export const cleanCommand = new Command('clean')
  .description('Clean and sanitize data')
  .requiredOption('-i, --input <path>', 'Input file or directory path')
  .option('-o, --output <path>', 'Output file path (default: overwrite input)')
  .option('--dedupe', 'Remove duplicate records', false)
  .option('--trim', 'Trim whitespace from strings', true)
  .option('-l, --lowercase', 'Convert strings to lowercase', false)
  .option('--remove-empty', 'Remove empty fields', true)
  .option('--normalize-newlines', 'Normalize line endings', true)
  // LLM filter options
  .option('--llm-filter', 'Filter text using LLM (profanity, relevance)', false)
  .addOption(
    new Option('--strictness <level>', 'LLM filter strictness (low, medium, high)')
      .choices(['low', 'medium', 'high'])
      .default('medium')
  )
  .option('--target <topic>', 'Target topic for relevance filtering')
  .option('--batch-size <number>', 'Batch size for LLM processing', '100')
  // Math verification
  .option('--verify-math', 'Verify mathematical expressions', false)
  // Fact checking
  .option('--fact-check', 'Fact check text using LLM', false)
  // Vision filter
  .option('--vision-filter', 'Filter images using vision (requires directory)', false)
  .option('--vision-target <topic>', 'Target topic for image relevance')
  .option('--check-nsfw', 'Check for NSFW content in images', true)
  .option('--remove-failed', 'Remove images that fail vision filter', false)
  .option('--vision-limit <number>', 'Limit number of images to filter (for quick testing)')
  .option('--vision-model <model>', 'Vision model to use (default: from config, fallback llava)')
  .option('--vision-prompt <prompt>', 'Custom vision analysis prompt')
  .option('--verbose', 'Show detailed vision filter output per image', false)
  .option('--vision-sensitivity <n>', 'Relevance threshold 0.0-1.0 (default: from config)')
  // Image cleanup pre-filters
  .option(
    '--remove-junk',
    'Remove SVGs, ICOs, icons, logos, favicons, spinners, small files (<5KB)',
    false
  )
  .option('--min-size <bytes>', 'Minimum file size in bytes (e.g. 10000 for 10KB)')
  .option('--min-dimensions <WxH>', 'Minimum image dimensions (e.g. 100x100)')
  // Image deduplication
  .option('--dedupe-images', 'Remove duplicate images using perceptual hashing', false)
  .option('--dedupe-images-dry-run', 'Show duplicate images without removing', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  // Concurrency options
  .option('--ollama-concurrency <n>', 'Concurrent Ollama text requests (default: 4)')
  .option('--vision-concurrency <n>', 'Concurrent Ollama vision requests (default: 2)')
  .option(
    '--ollama-instances <urls>',
    'Comma-separated Ollama server URLs for distributed processing'
  )
  .option('--auto-tune', 'Auto-detect optimal concurrency from available VRAM', false)
  .option('--no-trim', 'Disable whitespace trimming')
  .option('--no-remove-empty', 'Keep empty fields')
  .option('--no-normalize-newlines', 'Keep original line endings')
  .option('--no-check-nsfw', 'Skip NSFW checking')
  .option('--resume <checkpoint-file>', 'Resume from a saved checkpoint file')
  .action(
    wrapAction('clean', async (options) => {
      // Fix multi-word values split by enablePositionalOptions()
      if (Array.isArray(options.visionTarget))
        options.visionTarget = options.visionTarget.join(' ');

      const config = getConfig();
      if (options.verbose) process.env.VERBOSE = 'true';

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

      // Handle --dry-run
      if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
        const inputPath = path.resolve(options.input);
        const stats = await fs.stat(inputPath);
        const planned_actions: string[] = [];

        if (stats.isDirectory()) {
          planned_actions.push(`Scan directory: ${inputPath}`);
          if (options.visionFilter) planned_actions.push('Run vision filter on images');
          if (options.removeJunk)
            planned_actions.push('Remove junk images (SVGs, ICOs, small files)');
          if (options.dedupeImages)
            planned_actions.push('Deduplicate images using perceptual hashing');
        } else {
          planned_actions.push(`Load and clean records from: ${inputPath}`);
          if (options.dedupe) planned_actions.push('Deduplicate records');
          if (options.trim) planned_actions.push('Trim whitespace');
          if (options.lowercase) planned_actions.push('Convert to lowercase');
          if (options.removeEmpty) planned_actions.push('Remove empty fields');
          if (options.llmFilter)
            planned_actions.push(`LLM filter (strictness: ${options.strictness})`);
          if (options.verifyMath) planned_actions.push('Verify mathematical expressions');
          if (options.factCheck) planned_actions.push('Fact check text using LLM');
        }

        const outputPath = options.output ? path.resolve(options.output) : inputPath;
        planned_actions.push(`Write output to: ${outputPath}`);

        outputResult('clean', {
          dry_run: true,
          command: 'clean',
          planned_actions,
        });
        if (!isJsonMode()) {
          console.log(chalk.yellow('Dry run - no changes will be made.'));
          for (const action of planned_actions) {
            console.log(chalk.gray(`  - ${action}`));
          }
        }
        return;
      }

      if (!isJsonMode()) {
        console.log(chalk.blue('Cleaning data...'));
        console.log(chalk.gray(`Input: ${options.input}`));
      }

      try {
        const inputPath = path.resolve(options.input);
        const stats = await fs.stat(inputPath);

        // Handle directory (for vision filter and image cleanup)
        if (stats.isDirectory()) {
          const hasImageOps =
            options.visionFilter ||
            options.removeJunk ||
            options.minSize ||
            options.minDimensions ||
            options.dedupeImages ||
            options.dedupeImagesDryRun;
          if (hasImageOps) {
            await handleVisionFilter(inputPath, options, config);
          } else {
            if (!isJsonMode()) {
              console.error(
                chalk.red(
                  'Error: Directory input requires --vision-filter, --remove-junk, --min-size, or --min-dimensions'
                )
              );
            }
            exitWithCode(
              ExitCode.INVALID_INPUT,
              'Directory input requires --vision-filter, --remove-junk, --min-size, or --min-dimensions'
            );
          }
          return;
        }

        // Handle file input
        const fileContent = await fs.readFile(inputPath, 'utf-8');

        // Parse JSON or JSONL
        let data: unknown[];
        if (fileContent.trim().startsWith('[')) {
          data = safeJsonParse(fileContent, 'clean input file') as unknown[];
        } else {
          data = safeJsonlParse(fileContent, 'clean input file');
        }

        if (!isJsonMode()) {
          console.log(chalk.gray(`Loaded ${data.length} records`));
        }

        // ── Resume from checkpoint if requested ──
        const outputPath = options.output ? path.resolve(options.output) : inputPath;
        let resumedPhase = 0;
        let resumedData: unknown[] | null = null;
        if (options.resume) {
          const cp = await loadCommandCheckpoint(path.resolve(options.resume));
          if (cp && cp.command === 'clean') {
            resumedPhase = (cp.meta?.completedPhase as number) ?? 0;
            resumedData = cp.partialResults as unknown[];
            if (!isJsonMode()) {
              console.log(
                chalk.green(
                  `Resuming from checkpoint – skipping ${resumedPhase} completed phase(s), ${resumedData.length} records`
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

        // Count active phases for progress tracking
        const phases: string[] = ['Basic cleaning'];
        if (options.llmFilter) phases.push('LLM filter');
        if (options.verifyMath) phases.push('Math verification');
        if (options.factCheck) phases.push('Fact checking');

        // Set up SIGINT handler for checkpoint save
        let cleanAbortRequested = false;
        let currentPhaseIndex = 0;
        let currentCleaned: unknown[] = data;
        const cleanSigintHandler = async () => {
          cleanAbortRequested = true;
          if (!isJsonMode()) {
            console.log(chalk.yellow('\nAbort requested... saving checkpoint'));
          }
          const cp: CommandCheckpoint = {
            command: 'clean',
            outputPath,
            totalRecords: data.length,
            completedIndices: currentCleaned.map((_, i) => i),
            partialResults: currentCleaned,
            startedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            meta: { completedPhase: currentPhaseIndex, phases },
          };
          await saveCommandCheckpoint(cp);
          if (!isJsonMode()) {
            console.log(chalk.green(`Checkpoint saved: ${getCheckpointPath(outputPath)}`));
          }
        };
        process.on('SIGINT', cleanSigintHandler);

        const tracker = new ProgressTracker('Cleaning');
        tracker.start();
        tracker.setCounters({ records: data.length });
        let phaseIndex = 0;

        // Apply basic cleaning options
        if (resumedData && resumedPhase > 0) {
          // Skip basic cleaning phase – use resumed data
          currentCleaned = resumedData;
          if (!isJsonMode()) {
            console.log(chalk.gray(`Skipping basic cleaning (resumed)`));
          }
          phaseIndex++;
        } else {
          tracker.setPhase(`Basic cleaning (${phaseIndex + 1}/${phases.length})`);
          currentCleaned = cleanData(data, {
            dedupe: options.dedupe,
            trim: options.trim,
            lowercase: options.lowercase,
            removeEmpty: options.removeEmpty,
            normalizeNewlines: options.normalizeNewlines,
          });
          tracker.setCounters({ records: currentCleaned.length });
          currentPhaseIndex = 1;
          phaseIndex++;
        }

        // Apply LLM filter
        if (options.llmFilter && !cleanAbortRequested) {
          if (resumedPhase > phaseIndex) {
            if (!isJsonMode()) {
              console.log(chalk.gray(`Skipping LLM filter (resumed)`));
            }
          } else {
            tracker.setPhase(`LLM filter (${phaseIndex + 1}/${phases.length})`);
            tracker.setTotal(currentCleaned.length);
            currentCleaned = await applyLlmFilter(currentCleaned, options, config, (current) => {
              tracker.update(current);
            });
            currentPhaseIndex = phaseIndex + 1;
          }
          tracker.setCounters({ records: currentCleaned.length });
          phaseIndex++;
        }

        // Verify math
        if (options.verifyMath && !cleanAbortRequested) {
          if (resumedPhase > phaseIndex) {
            if (!isJsonMode()) {
              console.log(chalk.gray(`Skipping math verification (resumed)`));
            }
          } else {
            tracker.setPhase(`Math verification (${phaseIndex + 1}/${phases.length})`);
            tracker.setTotal(currentCleaned.length);
            currentCleaned = applyMathVerification(currentCleaned, (current) => {
              tracker.update(current);
            });
            currentPhaseIndex = phaseIndex + 1;
          }
          tracker.setCounters({ records: currentCleaned.length });
          phaseIndex++;
        }

        // Fact check
        if (options.factCheck && !cleanAbortRequested) {
          if (resumedPhase > phaseIndex) {
            if (!isJsonMode()) {
              console.log(chalk.gray(`Skipping fact checking (resumed)`));
            }
          } else {
            tracker.setPhase(`Fact checking (${phaseIndex + 1}/${phases.length})`);
            tracker.setTotal(currentCleaned.length);
            currentCleaned = await applyFactCheck(currentCleaned, (current) => {
              tracker.update(current);
            });
            currentPhaseIndex = phaseIndex + 1;
          }
          tracker.setCounters({ records: currentCleaned.length });
          phaseIndex++;
        }

        process.off('SIGINT', cleanSigintHandler);

        const cleaned = currentCleaned;
        tracker.complete(`${cleaned.length}/${data.length} records retained`);

        const outputContent =
          Array.isArray(cleaned) && !Array.isArray(cleaned[0])
            ? JSON.stringify(cleaned, null, 2)
            : cleaned.map((item) => JSON.stringify(item)).join('\n');

        await fs.writeFile(outputPath, outputContent, 'utf-8');
        if (!isJsonMode()) {
          console.log(chalk.green(`Cleaned data written to: ${outputPath}`));
        }

        // Clear checkpoint on successful completion
        await clearCommandCheckpoint(outputPath);

        outputResult('clean', {
          inputRecords: data.length,
          outputRecords: cleaned.length,
          outputFile: outputPath,
        });
      } catch (error) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error:'), error);
        }
        exitWithCode(
          ExitCode.GENERAL_ERROR,
          error instanceof Error ? error.message : String(error)
        );
      }
    })
  );

/** Handle vision filtering for images in a directory */
async function handleVisionFilter(
  dirPath: string,
  options: CleanOptions,
  config: ConfigLoader
): Promise<void> {
  const tracker = new ProgressTracker('Vision Filter');

  // Handle image deduplication first if requested
  if (options.dedupeImages || options.dedupeImagesDryRun) {
    const dryRun = options.dedupeImagesDryRun;
    tracker.start();
    tracker.setPhase('Finding duplicate images');

    const imageFiles = getImageFiles(dirPath);
    tracker.setCounters({ files: imageFiles.length });

    if (!isJsonMode()) {
      console.log(
        chalk.blue(
          dryRun ? 'Scanning for duplicate images (dry-run)...' : 'Removing duplicate images...'
        )
      );
    }

    const { removed, kept } = await removeDuplicateImages(dirPath, {
      dryRun,
    });

    tracker.setCounters({ kept: kept.length, removed: removed.length });

    if (dryRun) {
      tracker.complete(`Found ${removed.length} duplicate images (not removed)`);
      if (!isJsonMode()) {
        console.log(chalk.yellow(`Dry-run: ${removed.length} duplicate images would be removed:`));
        for (const file of removed) {
          console.log(chalk.gray(`  - ${path.basename(file)}`));
        }
      }
    } else {
      tracker.complete(`Removed ${removed.length} duplicate images, kept ${kept.length}`);
      if (!isJsonMode()) {
        console.log(chalk.green(`Removed ${removed.length} duplicate images`));
      }
    }

    // If only dedupe was requested, return early
    if (!options.visionFilter) {
      outputResult('clean', {
        operation: 'dedupe-images',
        dry_run: dryRun,
        removed: removed.length,
        kept: kept.length,
      });
      return;
    }
  }

  // Pre-filter: remove junk images, small files, undersized images
  const hasCleanupFlags = options.removeJunk || options.minSize || options.minDimensions;
  if (hasCleanupFlags) {
    const minDimensions = options.minDimensions
      ? (() => {
          const [w, h] = options.minDimensions.split('x').map(Number);
          return w > 0 && h > 0 ? { width: w, height: h } : undefined;
        })()
      : undefined;

    const cleanupResult = await filterJunkImages(dirPath, {
      removeJunk: options.removeJunk,
      minSize: options.minSize ? parseInt(options.minSize, 10) : undefined,
      minDimensions,
    });

    if (cleanupResult.removed.length > 0) {
      if (!isJsonMode()) {
        console.log(
          chalk.yellow(`\n  ${cleanupResult.removed.length} image(s) flagged for removal:`)
        );
        const preview = cleanupResult.removed.slice(0, 10);
        for (const r of preview) {
          console.log(chalk.gray(`    - ${path.basename(r.file)} (${r.reason})`));
        }
        if (cleanupResult.removed.length > 10) {
          console.log(chalk.gray(`    ... and ${cleanupResult.removed.length - 10} more`));
        }
      }

      let confirmed = options.yes;
      if (!confirmed) {
        confirmed = await confirm(`Remove ${cleanupResult.removed.length} junk images?`, true);
      }

      if (confirmed) {
        for (const r of cleanupResult.removed) {
          await fs.unlink(r.file);
        }
        if (!isJsonMode()) {
          console.log(
            chalk.green(
              `Removed ${cleanupResult.removed.length} junk images, ${cleanupResult.kept.length} remaining`
            )
          );
        }
      } else {
        if (!isJsonMode()) {
          console.log(chalk.yellow('Junk removal cancelled.'));
        }
      }
    } else {
      if (!isJsonMode()) {
        console.log(chalk.green('No junk images found.'));
      }
    }

    // If no vision filter requested, we're done
    if (!options.visionFilter) {
      outputResult('clean', {
        operation: 'image-cleanup',
        removed: cleanupResult.removed.length,
        kept: cleanupResult.kept.length,
      });
      return;
    }
  }

  // Get image files after deduplication and cleanup
  let files = getImageFiles(dirPath);
  if (files.length === 0) {
    if (!isJsonMode()) {
      console.log(chalk.yellow('No images found to filter'));
    }
    return;
  }

  const visionLimit = options.visionLimit ? parseInt(options.visionLimit, 10) : 0;
  if (visionLimit > 0 && visionLimit < files.length) {
    if (!isJsonMode()) {
      console.log(chalk.gray(`Limiting to ${visionLimit}/${files.length} images (--vision-limit)`));
    }
    files = files.slice(0, visionLimit);
  }

  tracker.start(files.length);
  tracker.setCounters({ files: files.length });
  tracker.setPhase('Analyzing images with vision model');

  const sensitivityRaw = options.visionSensitivity ?? config.get('visionSensitivity');
  const sensitivity =
    typeof sensitivityRaw === 'string' ? parseFloat(sensitivityRaw) : sensitivityRaw;

  // visionTarget may be joined from array earlier, but ensure it's a string
  const visionTarget = Array.isArray(options.visionTarget)
    ? options.visionTarget.join(' ')
    : options.visionTarget;

  const results = await filterImages(
    files,
    {
      sensitivity,
      target: visionTarget,
      checkNSFW: options.checkNsfw,
      checkRelevance: !!options.visionTarget,
      model: options.visionModel,
      prompt: options.visionPrompt,
      verbose: options.verbose,
      tracker,
    },
    (completed, total) => {
      tracker.update(completed, `Analyzed ${completed}/${total} images`);
    }
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  tracker.complete(`${passed}/${files.length} images passed`);

  // Print verbose summary
  if (options.verbose && results.length > 0 && !isJsonMode()) {
    const nsfwCount = results.filter((r) => r.isNSFW).length;
    const minorsCount = results.filter((r) => r.hasMinors).length;
    const lowRelevance = results.filter((r) => !r.passed && !r.isNSFW && !r.hasMinors).length;
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
    const relevanceResults = results.filter((r) => r.relevance !== undefined);
    const avgRelevance =
      relevanceResults.length > 0
        ? relevanceResults.reduce((sum, r) => sum + (r.relevance ?? 0), 0) / relevanceResults.length
        : undefined;

    const effectiveModel =
      options.visionModel ||
      config.get('ollamaVisionModel') ||
      config.get('ollamaModel') ||
      'llava';

    console.log(chalk.blue('\nVision Filter Summary'));
    console.log(chalk.gray(`  Model: ${effectiveModel}`));
    console.log(chalk.gray(`  Images processed: ${results.length}`));
    console.log(chalk.green(`  Passed: ${passed}`));
    console.log(chalk.red(`  Failed: ${failed}`));
    if (failed > 0) {
      console.log(chalk.gray(`    NSFW: ${nsfwCount}`));
      console.log(chalk.gray(`    Has minors: ${minorsCount}`));
      console.log(chalk.gray(`    Low relevance: ${lowRelevance}`));
    }
    console.log(chalk.gray(`  Avg confidence: ${avgConfidence.toFixed(2)}`));
    if (avgRelevance !== undefined) {
      console.log(chalk.gray(`  Avg relevance: ${avgRelevance.toFixed(2)}`));
    }
  }

  outputResult('clean', {
    operation: 'vision-filter',
    total: files.length,
    passed,
    failed,
    removed: false,
  });

  // Remove failed images (with confirmation)
  if (options.removeFailed && failed > 0) {
    const failedResults = results.filter((r) => !r.passed);

    if (!isJsonMode()) {
      console.log(chalk.yellow(`\n  ${failed} image(s) would be removed:`));
      const preview = failedResults.slice(0, 10);
      for (const r of preview) {
        console.log(chalk.gray(`    - ${path.basename(r.file)}`));
      }
      if (failedResults.length > 10) {
        console.log(chalk.gray(`    ... and ${failedResults.length - 10} more`));
      }
    }

    let confirmed = options.yes;
    if (!confirmed) {
      confirmed = await confirm(`Remove ${failed} failed images?`, true);
    }

    if (confirmed) {
      for (const result of failedResults) {
        await fs.unlink(result.file);
        if (!isJsonMode()) {
          console.log(chalk.gray(`Removed: ${result.file}`));
        }
      }
      if (!isJsonMode()) {
        console.log(chalk.green(`Removed ${failed} failed images.`));
      }
    } else {
      if (!isJsonMode()) {
        console.log(chalk.yellow('Removal cancelled.'));
      }
    }
  }
}

/** Apply LLM text filtering */
async function applyLlmFilter(
  data: unknown[],
  options: CleanOptions,
  config: ConfigLoader,
  onProgress?: (current: number) => void
): Promise<unknown[]> {
  const strictness = options.strictness || config.get('filterStrictness');
  const target = options.target;
  const batchSize = parseInt(options.batchSize, 10) || config.get('batchSize');

  // Extract text fields from data
  const texts = data.map((item) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      return JSON.stringify(item);
    }
    return String(item);
  });

  const results = await filterTexts(texts, {
    strictness: strictness as 'low' | 'medium' | 'high',
    target,
    batchSize,
    onProgress: onProgress ? (completed) => onProgress(completed) : undefined,
  });

  // Filter data based on results
  const filtered: unknown[] = [];
  for (let i = 0; i < data.length; i++) {
    if (results[i].passed) {
      filtered.push(data[i]);
    }
  }

  if (!isJsonMode()) {
    console.log(chalk.gray(`LLM filter: ${filtered.length}/${data.length} passed`));
  }
  return filtered;
}

/** Apply math verification */
function applyMathVerification(data: unknown[], onProgress?: (current: number) => void): unknown[] {
  const verified: unknown[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    const results = verifyMath(text);

    // Keep items with valid math or no math
    const hasInvalidMath = results.some((r) => !r.isValid);
    if (!hasInvalidMath) {
      verified.push(item);
    }

    if (onProgress) {
      onProgress(i + 1);
    }
  }

  if (!isJsonMode()) {
    console.log(chalk.gray(`Math verification: ${verified.length}/${data.length} passed`));
  }
  return verified;
}

/** Apply fact checking */
async function applyFactCheck(
  data: unknown[],
  onProgress?: (current: number) => void
): Promise<unknown[]> {
  const checked: unknown[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    const result = await factCheck(text);

    if (result.passed) {
      checked.push(item);
    }

    if (onProgress) {
      onProgress(i + 1);
    }
  }

  if (!isJsonMode()) {
    console.log(chalk.gray(`Fact check: ${checked.length}/${data.length} passed`));
  }
  return checked;
}
