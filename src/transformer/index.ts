/**
 * Transform orchestrator
 * Coordinates the 6-stage transformation pipeline
 */

import {
  TransformOptions,
  TransformResult,
  TransformProgress,
  TransformRecord,
  TransformStats,
  ScrapedPage,
  AssetRecord,
  ScrapedCombined,
  TransformCheckpoint,
} from './types';
import { autoLoadInput, loadManifest, loadScrapedData } from './asset-linker';
import { getTemplate } from './templates';
import { getOllama, ModelNotFoundError } from '../generators/ollama';
import { getConfig } from '../config';
import { verboseLog } from '../utils/logger';
import { isJsonMode } from '../utils/output';
import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint } from './checkpoint';
import { TransformDecisionLog } from './decision-log';

/**
 * Transform scraped data or asset manifest to structured records
 * 6-stage pipeline: Load & Detect → Pre-filter → Classify → Generate → Quality → Output
 */
export async function transformDataset(
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void
): Promise<TransformResult> {
  const startTime = Date.now();
  const taskId = `transform_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Check for existing checkpoint if resuming
  let checkpoint: TransformCheckpoint | null = null;
  const processedIds = new Set<string>();
  const partialResults: TransformRecord[] = [];
  let totalRecords = 0;

  if (options.resume && options.output) {
    checkpoint = await loadCheckpoint(options.output);
    if (checkpoint) {
      if (options.verbose) {
        verboseLog(
          `Found checkpoint: ${checkpoint.completedRecordIds.length}/${checkpoint.totalRecords} records processed`
        );
      }
      // Restore processed IDs from checkpoint
      checkpoint.completedRecordIds.forEach((id: string) => processedIds.add(id));
      partialResults.push(...checkpoint.partialResults);
      totalRecords = checkpoint.totalRecords;
    }
  }

  // Stage 1: Load & Detect
  if (options.verbose) {
    verboseLog('Stage 1: Loading and detecting input type...');
  }
  const inputData = await loadInputData(options.input, options);

  // Check Ollama connectivity if needed
  const template = getTemplate(options.template);
  if (!options.noLlm && (template.requiresLlm || template.usesVision)) {
    const ollama = getOllama();
    const isReachable = await ollama.ping();
    if (!isReachable) {
      const ollamaUrl = getConfig().get('ollamaUrl') || 'http://localhost:11434';
      if (options.explicitModel) {
        // User explicitly passed --model, so they expect it to work
        throw new Error(
          `Ollama is not reachable at ${ollamaUrl}.\n` +
            `  You specified --model ${options.model}, but no Ollama server is responding.\n` +
            `  Start Ollama: ollama run ${options.model}\n` +
            `  Or use --no-llm for deterministic-only mode.`
        );
      }
      console.warn(
        chalk.yellow('\n⚠️  Warning: Ollama VLLM not reachable at ') + chalk.cyan(ollamaUrl)
      );
      console.warn(chalk.yellow('   Falling back to deterministic mode (no LLM/vision calls).'));
      console.warn(
        chalk.yellow('   To enable AI-generated output, start Ollama with a vision model:')
      );
      console.warn(
        chalk.cyan('   ollama run llava') + chalk.gray('  (or other vision-capable model)\n')
      );
      options.noLlm = true;
    } else {
      // Ollama is reachable — ensure the requested model is available
      const model = options.model || getConfig().get('ollamaModel');
      if (model) {
        await ollama.ensureModel(model, options.yes);
      }
    }
  }

  // Prepare records based on input type
  let records: unknown[] = [];

  if (inputData.type === 'manifest' && inputData.manifest) {
    records = inputData.manifest.assets || [];
  } else if (inputData.type === 'scraped' && inputData.scraped) {
    records = inputData.scraped.pages || [];
  } else if (inputData.type === 'task-folder') {
    // Prefer manifest for image/audio templates, scraped for text
    if (template.supportedInputs.includes('image') || template.supportedInputs.includes('audio')) {
      records = inputData.manifest?.assets || inputData.scraped?.pages || [];
    } else {
      records = inputData.scraped?.pages || inputData.manifest?.assets || [];
    }
  }

  // Ensure records is always an array (defensive - handles malformed JSON)
  if (!Array.isArray(records)) {
    records = [];
  }

  if (records.length === 0) {
    throw new Error('No records found in input');
  }

  // Task 2.4: Early validation — check that at least 1 asset file actually exists on disk
  if (template.supportedInputs.includes('image') || template.supportedInputs.includes('audio')) {
    const assetRecords = records as AssetRecord[];
    const assetDir = options.assetDir || path.dirname(options.input);
    const sampled = assetRecords.filter((a) => a.localPath && a.status === 'completed').slice(0, 5);

    if (sampled.length > 0) {
      // First check if assetDir itself exists
      const dirExists = await fs.stat(assetDir).catch(() => null);
      if (!dirExists) {
        throw new Error(
          `Asset directory not found: "${assetDir}".\n` +
            `  Check that assetDir points to the correct task folder.`
        );
      }

      let foundCount = 0;
      for (const asset of sampled) {
        const fullPath = path.resolve(assetDir, asset.localPath);
        try {
          await fs.access(fullPath);
          foundCount++;
        } catch {
          // File not accessible
        }
      }
      if (foundCount === 0) {
        // Warn but don't throw — templates handle missing files individually
        if (!isJsonMode()) {
          console.warn(
            chalk.yellow(
              `\n  Warning: No asset files found. Checked ${sampled.length} sample paths under "${assetDir}".`
            )
          );
          console.warn(chalk.yellow(`  Example: ${path.resolve(assetDir, sampled[0].localPath)}`));
          console.warn(
            chalk.yellow(
              `  Check that assetDir points to the correct task folder. Pipeline may produce 0 output.\n`
            )
          );
        }
        if (options.verbose) {
          verboseLog(`Early validation: 0/${sampled.length} sample asset files found on disk`);
        }
      }
    }
  }

  // Initialize checkpoint data
  if (totalRecords === 0) {
    totalRecords = records.length;
  }

  // Filter out already processed records if resuming
  const getRecordId = (r: unknown): string => {
    const record = r as { id?: string; source_url?: string };
    return record.id || record.source_url || JSON.stringify(r).slice(0, 50);
  };

  const recordsToProcess = records.filter((r) => !processedIds.has(getRecordId(r)));

  if (options.resume && checkpoint && recordsToProcess.length < records.length) {
    console.log(
      chalk.cyan(
        `Resuming: ${processedIds.size}/${records.length} records already processed, ${recordsToProcess.length} remaining`
      )
    );
  }

  if (recordsToProcess.length === 0) {
    // All records already processed, return checkpoint results
    if (checkpoint) {
      return {
        records: checkpoint.partialResults,
        stats: {
          inputCount: totalRecords,
          filteredCount: 0,
          classifiedCount: 0,
          relevantCount: checkpoint.partialResults.length,
          generatedCount: checkpoint.partialResults.length,
          outputCount: checkpoint.partialResults.length,
          errorCount: checkpoint.failedRecordIds.length,
          duration: Date.now() - startTime,
        },
      };
    }
    throw new Error('No records to process');
  }

  if (options.verbose) {
    verboseLog(
      `Processing ${recordsToProcess.length} records (${processedIds.size} already processed)`
    );
  }

  // Initialize checkpoint if not exists
  if (!checkpoint && options.output) {
    checkpoint = {
      taskId,
      inputPath: options.input,
      template: options.template,
      options: { ...options },
      totalRecords,
      completedRecordIds: [],
      failedRecordIds: [],
      outputPath: options.output,
      partialResults: [],
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  // Wrap progress callback to save checkpoints
  const wrappedProgressCb = (progress: TransformProgress) => {
    progressCb?.(progress);

    // Save checkpoint periodically (every 10 records or on completion)
    if (checkpoint && progress.completed > 0 && progress.completed % 10 === 0) {
      checkpoint.completedRecordIds = Array.from(processedIds);
      checkpoint.partialResults = partialResults;
      saveCheckpoint(checkpoint).catch((err) => {
        verboseLog(`Failed to save checkpoint: ${err}`);
      });
    }
  };

  // Create decision log if enabled (default: true)
  const decisionLog = options.log !== false ? new TransformDecisionLog() : undefined;
  if (decisionLog) {
    options._decisionLog = decisionLog;
  }

  // Run template processing with filtered records
  const result = await template.process(recordsToProcess, options, wrappedProgressCb);

  // Check global abort flag directly (templates may not set abortedEarly)
  const wasAborted =
    !!(globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag ||
    result.stats.abortedEarly;
  if (wasAborted) result.stats.abortedEarly = true;

  // Track completed record IDs from results for checkpoint
  for (const record of result.records) {
    const meta = (record as TransformRecord)._meta;
    const id = meta?.assetId || meta?.sourceUrl;
    if (id) processedIds.add(id);
  }
  partialResults.push(...(result.records as TransformRecord[]));

  // Merge partial results if resuming
  if (options.resume && checkpoint && partialResults.length > result.records.length) {
    // partialResults already contains both old + new records
    result.records = partialResults;
    result.stats.inputCount = totalRecords;
    result.stats.outputCount = result.records.length;
  }

  // Update stats with total duration
  result.stats.duration = Date.now() - startTime;

  // Write decision log as JSONL alongside output
  let decisionLogPath: string | undefined;
  if (decisionLog && options.output) {
    const outputDir = path.dirname(options.output);
    decisionLogPath = path.join(outputDir, 'transform_decisions.jsonl');
    const jsonlContent = decisionLog.toJsonl();
    if (jsonlContent) {
      await fs.writeFile(decisionLogPath, jsonlContent, 'utf-8');
    } else {
      decisionLogPath = undefined;
    }
  }

  // Attach decision log path to result for JSON output
  if (decisionLogPath) {
    result.decisionLogPath = decisionLogPath;
  }

  // Save or clear checkpoint based on abort status
  if (options.output) {
    if (wasAborted) {
      // Create checkpoint on fresh runs if needed
      const cp: TransformCheckpoint = checkpoint || {
        taskId,
        inputPath: options.input,
        template: options.template,
        options: { ...options },
        totalRecords,
        completedRecordIds: [],
        failedRecordIds: [],
        outputPath: options.output,
        partialResults: [],
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      };
      cp.completedRecordIds = Array.from(processedIds);
      cp.partialResults = partialResults;
      cp.lastUpdatedAt = new Date().toISOString();
      await saveCheckpoint(cp);
    } else if (checkpoint) {
      await clearCheckpoint(options.output);
    }
  }

  return result;
}

/**
 * Load input data from various sources
 */
async function loadInputData(
  inputPath: string,
  options: TransformOptions
): Promise<{
  type: 'manifest' | 'scraped' | 'task-folder';
  manifest?: { assets: AssetRecord[]; searchQuery: string | null };
  scraped?: { pages: ScrapedPage[]; searchQuery: string | null };
}> {
  try {
    const input = await autoLoadInput(inputPath);

    if (input.type === 'task-folder') {
      return {
        type: 'task-folder',
        manifest: input.manifest
          ? {
              assets: input.manifest.assets || [],
              searchQuery: input.manifest.searchQuery,
            }
          : undefined,
        scraped: input.scraped
          ? {
              pages: input.scraped.pages || [],
              searchQuery: input.scraped.searchQuery,
            }
          : undefined,
      };
    }

    if (input.type === 'manifest' && input.manifest) {
      return {
        type: 'manifest',
        manifest: {
          assets: input.manifest.assets || [],
          searchQuery: input.manifest.searchQuery,
        },
      };
    }

    if (input.type === 'scraped' && input.scraped) {
      return {
        type: 'scraped',
        scraped: {
          pages: input.scraped.pages || [],
          searchQuery: input.scraped.searchQuery,
        },
      };
    }

    throw new Error(`Unable to load data from ${inputPath}`);
  } catch (error) {
    // Try loading as a directory containing task files
    const stats = await fs.stat(inputPath).catch(() => null);
    if (stats?.isDirectory()) {
      const files = await fs.readdir(inputPath);

      let manifest: { assets: AssetRecord[]; searchQuery: string | null } | undefined;
      let scraped: { pages: ScrapedPage[]; searchQuery: string | null } | undefined;

      // Look for manifest
      const manifestFile = files.find(
        (f) => f.toLowerCase().includes('manifest') && f.endsWith('.json')
      );
      if (manifestFile) {
        const data = await loadManifest(path.join(inputPath, manifestFile));
        manifest = {
          assets: data.assets || [],
          searchQuery: data.searchQuery,
        };
      }

      // Look for scraped data
      const scrapedFile = files.find(
        (f) =>
          f.toLowerCase().includes('scraped') ||
          (f.toLowerCase().startsWith('scraped_combined') && f.endsWith('.json'))
      );
      if (scrapedFile) {
        const data = await loadScrapedData(path.join(inputPath, scrapedFile));
        scraped = {
          pages: data.pages || [],
          searchQuery: data.searchQuery,
        };
      }

      return {
        type: 'task-folder',
        manifest,
        scraped,
      };
    }

    throw error;
  }
}

/**
 * Write transform output to file
 */
export async function writeTransformOutput(
  result: TransformResult,
  outputPath: string
): Promise<void> {
  const ext = path.extname(outputPath).toLowerCase();
  const dir = path.dirname(outputPath);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Write main output
  if (ext === '.jsonl') {
    const lines = result.records.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(outputPath, lines, 'utf-8');
  } else {
    // Default to JSON
    await fs.writeFile(outputPath, JSON.stringify(result.records, null, 2), 'utf-8');
  }

  // Also write JSONL version if output is JSON
  if (ext === '.json') {
    const jsonlPath = outputPath.replace(/\.json$/, '.jsonl');
    const lines = result.records.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, lines, 'utf-8');
  }
}

/**
 * Print transform statistics
 */
export function printTransformStats(stats: TransformStats): void {
  if (isJsonMode()) return;

  console.log('\n' + chalk.bold('Transform Statistics:'));

  // --- Funnel: Input ---
  if (
    stats.completedInputCount !== undefined &&
    stats.failedInputCount !== undefined &&
    stats.failedInputCount > 0
  ) {
    console.log(
      `  Input: ${stats.inputCount} (${stats.completedInputCount} completed, ${chalk.yellow(stats.failedInputCount + ' failed download')})`
    );
  } else {
    console.log(`  Input: ${stats.inputCount}`);
  }

  // --- Funnel: Filtered ---
  if (stats.filterReasons && stats.filteredCount > 0) {
    const reasons = stats.filterReasons;
    const reasonParts: string[] = [];
    if (reasons.invalidUrl > 0) reasonParts.push(`${reasons.invalidUrl} invalid URL`);
    if (reasons.invalidTitle > 0) reasonParts.push(`${reasons.invalidTitle} no title`);
    if (reasons.textTooShort > 0) reasonParts.push(`${reasons.textTooShort} too short`);
    if (reasons.textTooLong > 0) reasonParts.push(`${reasons.textTooLong} too long`);
    if (reasons.lowWordRatio > 0) reasonParts.push(`${reasons.lowWordRatio} low word ratio`);
    if (reasons.missingText > 0) reasonParts.push(`${reasons.missingText} missing text`);

    if (reasonParts.length > 0) {
      console.log(`  Filtered: ${chalk.yellow(stats.filteredCount)} (${reasonParts.join(', ')})`);
    } else {
      console.log(`  Filtered: ${chalk.yellow(stats.filteredCount)}`);
    }
  } else {
    console.log(`  Filtered: ${stats.filteredCount}`);
  }

  // --- Funnel: Candidates (Input - Filtered) ---
  const candidateCount = stats.inputCount - stats.filteredCount;
  console.log(`  Candidates: ${candidateCount}`);

  // --- Classification breakdown ---
  if (stats.visionFallbackCount && stats.visionFallbackCount > 0) {
    const vllmCount = stats.generatedCount - stats.visionFallbackCount;
    console.log(
      `  Classification: ${chalk.green(vllmCount)} VLLM, ${chalk.yellow(stats.visionFallbackCount)} fallback`
    );
  } else if (stats.generationFailedCount && stats.generationFailedCount > 0) {
    const llmCount = stats.generatedCount - stats.generationFailedCount;
    console.log(
      `  Classification: ${chalk.green(llmCount)} LLM, ${chalk.yellow(stats.generationFailedCount)} fallback`
    );
  }

  // Warn on high fallback rate
  if (
    stats.generationFailedCount &&
    stats.generatedCount > 0 &&
    stats.generationFailedCount / stats.generatedCount > 0.5
  ) {
    console.warn(
      chalk.yellow(
        '  \u26A0 High fallback rate \u2014 consider using a larger model or checking input data quality'
      )
    );
  }

  // Fallback reasons breakdown
  if (stats.fallbackReasons) {
    const fr = stats.fallbackReasons;
    const parts: string[] = [];
    if (fr.vllm_failed) parts.push(`${fr.vllm_failed} VLLM failed`);
    if (fr.unsupported_format) parts.push(`${fr.unsupported_format} unsupported format`);
    if (fr.generation_failed) parts.push(`${fr.generation_failed} generation failed`);
    for (const [key, val] of Object.entries(fr)) {
      if (val && !['vllm_failed', 'unsupported_format', 'generation_failed'].includes(key)) {
        parts.push(`${val} ${key.replace(/_/g, ' ')}`);
      }
    }
    if (parts.length > 0) {
      console.log(`  Fallback reasons: ${chalk.cyan(parts.join(', '))}`);
    }
  }

  // Unsupported format breakdown
  if (stats.unsupportedFormatCount && stats.unsupportedFormatCount > 0) {
    let formatDetail = '';
    if (stats.formatBreakdown) {
      const parts = Object.entries(stats.formatBreakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([ext, count]) => `${count} ${ext}`);
      formatDetail = ` (${parts.join(', ')})`;
    }
    console.log(
      `  Unsupported formats: ${chalk.yellow(stats.unsupportedFormatCount)}${formatDetail}`
    );

    // Task 3.2: Warn when >50% unsupported formats
    if (stats.classifiedCount && stats.unsupportedFormatCount / stats.classifiedCount > 0.5) {
      console.warn(
        chalk.yellow(
          '  \u26A0 Over 50% of images are unsupported formats \u2014 consider filtering or converting them'
        )
      );
    }

    // Task 3.3: Format conversion tip
    console.log(
      chalk.gray('  Tip: Convert GIF/WebP to JPEG/PNG before transform for better classification.')
    );
    console.log(chalk.gray('       Or use --no-llm for deterministic-only mode.'));
  }

  // --- Relevance filter summary ---
  if (stats.dropReasons?.below_threshold !== undefined && stats.dropReasons.below_threshold > 0) {
    const kept = stats.outputCount;
    const dropped = stats.dropReasons.below_threshold;
    const thresholdStr =
      stats.relevanceThreshold !== undefined ? ` (threshold: ${stats.relevanceThreshold})` : '';
    console.log(
      `  Relevance filter: ${chalk.green(kept + ' kept')}, ${chalk.yellow(dropped + ' dropped')}${thresholdStr}`
    );
  }

  // --- Funnel: Dropped ---
  // Compute total actual drops from dropReasons
  let totalDropped = 0;
  const dropParts: string[] = [];
  if (stats.dropReasons) {
    const dr = stats.dropReasons;
    if (dr.below_threshold) {
      totalDropped += dr.below_threshold;
      dropParts.push(`${dr.below_threshold} below threshold`);
    }
    if (dr.no_fallback) {
      totalDropped += dr.no_fallback;
      dropParts.push(`${dr.no_fallback} no fallback`);
    }
    if (dr.no_classification) {
      totalDropped += dr.no_classification;
      dropParts.push(`${dr.no_classification} no classification`);
    }
    if (dr.quality_filtered) {
      totalDropped += dr.quality_filtered;
      dropParts.push(`${dr.quality_filtered} quality filtered`);
    }
    if (dr.empty_output) {
      totalDropped += dr.empty_output;
      dropParts.push(`${dr.empty_output} empty output`);
    }
    if (dr.generation_failed) {
      totalDropped += dr.generation_failed;
      dropParts.push(`${dr.generation_failed} generation failed`);
    }
    if (dr.file_not_found) {
      totalDropped += dr.file_not_found;
      dropParts.push(`${dr.file_not_found} file not found`);
    }
  }
  if (
    stats.qualityFilteredCount &&
    stats.qualityFilteredCount > 0 &&
    !stats.dropReasons?.quality_filtered
  ) {
    totalDropped += stats.qualityFilteredCount;
    dropParts.push(`${stats.qualityFilteredCount} quality filtered`);
  }
  if (stats.skippedCount && stats.skippedCount > 0) {
    totalDropped += stats.skippedCount;
    dropParts.push(`${stats.skippedCount} skipped (no-fallback)`);
  }

  // Task 3.4: Only show drop reasons when there are actual drops
  if (totalDropped > 0) {
    console.log(`  Dropped: ${chalk.yellow(totalDropped)} (${dropParts.join(', ')})`);
  } else {
    console.log(`  Dropped: 0`);
  }

  // --- Funnel: Output ---
  console.log(`  Output: ${chalk.green(stats.outputCount)}`);

  if (stats.errorCount > 0) {
    console.log(`  Errors: ${chalk.yellow(stats.errorCount)}`);
  }
  if (stats.abortedEarly) {
    console.log(chalk.yellow('  \u26A0 Processing interrupted \u2014 use --resume to continue'));
  }
  console.log(`  Duration: ${(stats.duration / 1000).toFixed(1)}s`);
  if (stats.generationDuration !== undefined && stats.generatedCount > 0) {
    const avgMs = stats.avgRecordDuration ?? stats.generationDuration / stats.generatedCount;
    console.log(
      `  Generation: ${(stats.generationDuration / 1000).toFixed(1)}s (avg ${Math.round(avgMs)}ms/record)`
    );
  }
}

/**
 * Set global abort flag
 */
export function setTransformAbort(value: boolean): void {
  (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = value;
}

// Export all template types
export * from './types';
export * from './templates';
export { autoLoadInput, linkAssetsToPages, loadManifest, loadScrapedData } from './asset-linker';
export {
  isJunkAsset,
  removeBoilerplate,
  inferLabelFromContext,
  deterministicRelevance,
  deterministicQA,
  detectDuplicateContent,
  filterScrapedPages,
  filterAssets,
  deduplicateRecords,
} from './deterministic';
export {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  getCheckpointPath,
  hasCheckpoint,
} from './checkpoint';
export { TransformDecisionLog } from './decision-log';
export type { DecisionEntry, DecisionStage, DecisionAction, DecisionSummary } from './decision-log';
