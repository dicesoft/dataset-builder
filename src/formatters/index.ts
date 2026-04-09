/**
 * Main entry point for dataset formatting
 * Coordinates cleanup, field mapping, splitting, and formatting
 */

import fs from 'fs/promises';
import path from 'path';
import { getFormatter } from './registry';
import { runCleanup } from './cleanup';
import type {
  FormatOptions,
  FormattedOutput,
  FormatMetadata,
  DatasetStats,
  CleanupOptions,
  SplitData,
  ChatMLOptions,
  ShareGPTOptions,
  OASSTOptions,
  AlpacaOptions,
  LLaVAOptions,
  ImageFolderOptions,
  COCOOptions,
  YOLOOptions,
  COCOSegOptions,
  YOLOSegOptions,
  AudioFolderOptions,
  SpeechTextOptions,
  DatasetDictOptions,
} from './types';
import {
  applyFieldMapToDataset,
  splitDataset,
  parseSplitRatios,
  computeStatistics,
  ensureDir,
  loadData,
  writeData,
  resolveDirectoryInput,
} from './utils';

// Import and register formatters
import { registerFormatter } from './registry';
import { alpacaFormatter } from './text/alpaca';
import { chatmlFormatter } from './text/chatml';
import { sharegptFormatter } from './text/sharegpt';
import { oasstFormatter } from './text/oasst';
import { rawFormatter } from './text/raw';
import { llavaFormatter } from './vision/llava';
import { imagefolderFormatter } from './vision/imagefolder';
import { csvImagesFormatter } from './vision/csv-images';
import { cocoFormatter } from './vision/coco';
import { yoloFormatter } from './vision/yolo';
import { cocoSegFormatter } from './vision/coco-seg';
import { yoloSegFormatter } from './vision/yolo-seg';
import { audiofolderFormatter } from './audio/audiofolder';
import { speechTextFormatter } from './audio/speech-text';
import { datasetdictFormatter } from './huggingface/datasetdict';
import { parquetFormatter } from './huggingface/parquet';
import { writeDatasetCard } from './huggingface/card';
import { inferHFSchema } from './huggingface/utils';

// Register text formatters
registerFormatter('alpaca', alpacaFormatter);
registerFormatter('chatml', chatmlFormatter);
registerFormatter('sharegpt', sharegptFormatter);
registerFormatter('oasst', oasstFormatter);
registerFormatter('raw', rawFormatter);

// Register vision formatters
registerFormatter('llava', llavaFormatter);
registerFormatter('imagefolder', imagefolderFormatter);
registerFormatter('csv-images', csvImagesFormatter);
registerFormatter('coco', cocoFormatter);
registerFormatter('yolo', yoloFormatter);
registerFormatter('coco-seg', cocoSegFormatter);
registerFormatter('yolo-seg', yoloSegFormatter);

// Register audio formatters
registerFormatter('audiofolder', audiofolderFormatter);
registerFormatter('speech-text', speechTextFormatter);

// Register HuggingFace formatters
registerFormatter('datasetdict', datasetdictFormatter);
registerFormatter('parquet', parquetFormatter);

/** Default chunk size for chunked record processing */
const DEFAULT_CHUNK_SIZE = 1000;

/**
 * Main formatting function
 * Orchestrates the full formatting pipeline: load -> cleanup -> map -> split -> format -> output
 * @param options - Formatting options
 * @param chunkSize - Number of records to process per chunk during cleanup and field mapping (default: 1000)
 */
export async function formatDataset(
  options: FormatOptions,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<FormattedOutput> {
  const startTime = Date.now();
  const formatter = getFormatter(options.formatter || 'alpaca');

  if (!formatter) {
    throw new Error(`Unknown formatter: ${options.formatter}`);
  }

  // Load input data (may resolve directory to a specific file)
  const loadResult = await loadInputData(options);
  const data = loadResult.data;

  // If the input was a directory that got resolved, update basePath to point to the resolved file's directory
  if (loadResult.resolvedPath && loadResult.resolvedPath !== options.inputPath) {
    options = { ...options, basePath: path.dirname(path.resolve(loadResult.resolvedPath)) };
  }

  // Run cleanup and field mapping in chunks for memory efficiency
  let cleanupStats = { removed: 0, modified: 0 };
  const mappedData: Record<string, unknown>[] = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    let chunk = data.slice(i, i + chunkSize);

    // Run cleanup pipeline on this chunk if enabled
    if (options.cleanup) {
      const cleanupResult = await runCleanup(chunk, options.cleanup);
      chunk = cleanupResult.data;
      cleanupStats.removed += cleanupResult.stats.removed;
      cleanupStats.modified += cleanupResult.stats.modified;
    }

    // Apply field mapping to this chunk
    const mappedChunk = options.fieldMap
      ? applyFieldMapToDataset(chunk, options.fieldMap)
      : (chunk as Record<string, unknown>[]);

    mappedData.push(...mappedChunk);
  }

  // Validate data (after field mapping)
  const validation = formatter.validate(mappedData, options);
  if (!validation.valid) {
    const errorCount = validation.errors.length;
    const sample = validation.errors
      .slice(0, 3)
      .map((e) => `  - ${e.message}`)
      .join('\n');
    const existingFields =
      mappedData.length > 0 ? Object.keys(mappedData[0] as Record<string, unknown>) : [];
    const fieldInfo =
      existingFields.length > 0
        ? `\nFields in data: [${existingFields.join(', ')}]`
        : '\nFields in data: (empty records)';
    const hint = options.fieldMap
      ? '\nField mapping was applied. Check that your --field-map maps source fields to the required format fields.'
      : '\nTip: Use --field-map to map your data fields to the expected format fields.';
    throw new Error(`Validation failed with ${errorCount} errors:\n${sample}${fieldInfo}${hint}`);
  }

  // Formatters that handle their own splitting bypass orchestrator split logic
  const isHFFormatter = !!formatter.handlesOwnSplitting;

  let result: FormattedOutput;

  if (isHFFormatter) {
    // Pass full data + splitRatios directly to the formatter
    await ensureDir(options.outputDir);
    result = await formatter.format(mappedData, options);

    // Write metadata.json for HF formatters (same as normal path)
    const stats = computeStatistics(mappedData);
    const hfMetadata: FormatMetadata = {
      ...result.metadata,
      stats,
      fieldMap: options.fieldMap,
      cleanup: options.cleanup
        ? {
            enabled: true,
            removed: cleanupStats.removed,
            modified: cleanupStats.modified,
          }
        : undefined,
    };
    await writeData(path.join(options.outputDir, 'metadata.json'), hfMetadata, true);
    result.metadata = hfMetadata;
  } else {
    // Standard orchestrator: split then format each split
    let splitData: SplitData<Record<string, unknown>>;
    if (options.splitRatios) {
      splitData = splitDataset(mappedData, options.splitRatios, options.seed);
    } else {
      splitData = {
        train: mappedData,
        validation: [],
        test: [],
      };
    }

    await ensureDir(options.outputDir);

    const files: FormattedOutput['files'] = {
      train: [],
      validation: [],
      test: [],
    };

    const counts = {
      train: splitData.train.length,
      validation: splitData.validation.length,
      test: splitData.test.length,
      total: mappedData.length,
    };

    // Format train split
    if (splitData.train.length > 0) {
      const trainOutput = await formatter.format(splitData.train, {
        ...options,
        outputDir: path.join(options.outputDir, 'train'),
      });
      files.train = trainOutput.files.all || [];
    }

    // Format validation split
    if (splitData.validation.length > 0) {
      const valOutput = await formatter.format(splitData.validation, {
        ...options,
        outputDir: path.join(options.outputDir, 'validation'),
      });
      files.validation = valOutput.files.all || [];
    }

    // Format test split
    if (splitData.test.length > 0) {
      const testOutput = await formatter.format(splitData.test, {
        ...options,
        outputDir: path.join(options.outputDir, 'test'),
      });
      files.test = testOutput.files.all || [];
    }

    // Generate metadata
    const stats = computeStatistics(mappedData);
    const metadata: FormatMetadata = {
      formatter: formatter.name,
      datasetName: options.datasetName || 'dataset',
      timestamp: startTime,
      counts: {
        ...counts,
        input: options.cleanup ? counts.total + cleanupStats.removed : counts.total,
      },
      stats,
      fieldMap: options.fieldMap,
      cleanup: options.cleanup
        ? {
            enabled: true,
            removed: cleanupStats.removed,
            modified: cleanupStats.modified,
            stages: 'stages' in cleanupStats ? cleanupStats.stages : undefined,
          }
        : undefined,
    };

    // Write metadata file
    await writeData(path.join(options.outputDir, 'metadata.json'), metadata, true);

    result = {
      outputDir: options.outputDir,
      files,
      metadata,
    };
  }

  // Dataset card generation hook - works with ANY formatter
  if (options.generateCard && !isHFFormatter) {
    const schema = inferHFSchema(mappedData);
    const splits: Array<{ name: string; numExamples: number }> = [];
    if (result.metadata.counts.train > 0) {
      splits.push({ name: 'train', numExamples: result.metadata.counts.train });
    }
    if (result.metadata.counts.validation > 0) {
      splits.push({ name: 'validation', numExamples: result.metadata.counts.validation });
    }
    if (result.metadata.counts.test > 0) {
      splits.push({ name: 'test', numExamples: result.metadata.counts.test });
    }
    if (splits.length === 0) {
      splits.push({ name: 'all', numExamples: result.metadata.counts.total });
    }

    const extOpts = options as ExtendedFormatOptions;
    await writeDatasetCard(options.outputDir, {
      datasetName: options.datasetName || 'dataset',
      description: extOpts.cardDescription,
      license: extOpts.cardLicense,
      taskCategories: extOpts.cardTaskCategories,
      language: extOpts.cardLanguage,
      features: schema,
      splits,
      totalExamples: result.metadata.counts.total,
      formatter: formatter.name,
      fieldStats: result.metadata.stats?.fieldStats,
    });
  }

  return result;
}

/**
 * Load input data from file or array.
 * If inputPath is a directory, auto-resolves to a known data file inside it.
 * @returns Object with loaded data and the resolved input path (may differ from original if directory was resolved)
 */
async function loadInputData(
  options: FormatOptions
): Promise<{ data: unknown[]; resolvedPath?: string }> {
  if (options.inputData) {
    return { data: options.inputData };
  }

  if (options.inputPath) {
    // Check if path is a directory and resolve before loading
    const fsModule = await import('fs/promises');
    try {
      const stat = await fsModule.stat(options.inputPath);
      if (stat.isDirectory()) {
        const resolved = await resolveDirectoryInput(options.inputPath);
        if (resolved) {
          const data = await loadData(resolved);
          return { data, resolvedPath: resolved };
        }
        // If no known file found, loadData will throw a helpful CLIError
      }
    } catch (err) {
      // Ignore stat errors, let loadData handle them
      if (err && typeof err === 'object' && 'code' in err && (err as any).code !== 'ENOENT') {
        throw err;
      }
    }
    const data = await loadData(options.inputPath);
    return { data, resolvedPath: options.inputPath };
  }

  throw new Error('Either inputData or inputPath must be provided');
}

/**
 * Extended format options with input source and all formatter-specific options
 */
export interface ExtendedFormatOptions extends FormatOptions {
  /** Input data array (alternative to inputPath) */
  inputData?: unknown[];
  /** Input file path */
  inputPath?: string;
  /** Formatter name */
  formatter: string;
  /** Cleanup options */
  cleanup?: CleanupOptions;
  // ChatML-specific
  /** Role mapping for custom field names (ChatML) */
  roleMap?: ChatMLOptions['roleMap'];
  /** Field containing conversation ID for multi-turn grouping (ChatML) */
  conversationIdField?: ChatMLOptions['conversationIdField'];
  /** Whether to include system message (ChatML) */
  includeSystem?: ChatMLOptions['includeSystem'];
  // ShareGPT-specific
  /** Field containing conversation ID for threading (ShareGPT) */
  conversationField?: ShareGPTOptions['conversationField'];
  /** Mapping for human messages (ShareGPT) */
  humanField?: ShareGPTOptions['humanField'];
  /** Mapping for bot/assistant messages (ShareGPT) */
  assistantField?: ShareGPTOptions['assistantField'];
  // OASST-specific
  /** Language code for all messages (OASST) */
  lang?: OASSTOptions['lang'];
  /** Field containing the message tree ID (OASST) */
  treeIdField?: OASSTOptions['treeIdField'];
  /** Field containing the parent message ID (OASST) */
  parentIdField?: OASSTOptions['parentIdField'];
  // Alpaca-specific
  /** Whether to include empty input field (Alpaca) */
  includeEmptyInput?: AlpacaOptions['includeEmptyInput'];
  /** Default value for input field if not provided (Alpaca) */
  defaultInput?: AlpacaOptions['defaultInput'];
  // LLaVA-specific
  /** Image placeholder token (LLaVA) */
  imageToken?: LLaVAOptions['imageToken'];
  /** Whether to embed images as base64 (LLaVA) */
  embedImages?: LLaVAOptions['embedImages'];
  /** Maximum image size for embedding in bytes (LLaVA) */
  maxEmbedSize?: LLaVAOptions['maxEmbedSize'];
  // ImageFolder-specific
  /** Field containing class/category label (ImageFolder, YOLO) */
  classField?: string;
  /** Image file extensions to include (ImageFolder) */
  imageExtensions?: ImageFolderOptions['imageExtensions'];
  // COCO-specific
  /** Field containing bounding boxes (COCO, YOLO) */
  bboxField?: COCOOptions['bboxField'];
  /** Field containing category ID (COCO) */
  categoryIdField?: COCOOptions['categoryIdField'];
  /** Field containing category name (COCO) */
  categoryNameField?: COCOOptions['categoryNameField'];
  // YOLO-specific
  /** Image width for bbox normalization (YOLO) */
  imageWidth?: YOLOOptions['imageWidth'];
  /** Image height for bbox normalization (YOLO) */
  imageHeight?: YOLOOptions['imageHeight'];
  // Segmentation formatter options
  /** Field containing mask file path (COCO-Seg, YOLO-Seg) */
  maskField?: string;
  // Audio formatter options
  /** Audio file extensions to include (AudioFolder, SpeechText) */
  audioExtensions?: AudioFolderOptions['audioExtensions'];
  /** Field containing transcription text (SpeechText) */
  textField?: SpeechTextOptions['textField'];
  /** Field containing pre-existing duration value (SpeechText) */
  durationField?: SpeechTextOptions['durationField'];
  /** Use ffprobe to extract audio duration (SpeechText) */
  extractDuration?: SpeechTextOptions['extractDuration'];
  // HuggingFace formatter options
  /** Output format for HF formatters: 'json' (default) or 'parquet' */
  outputFormat?: DatasetDictOptions['outputFormat'];
  /** HF features schema (auto-inferred if not provided) */
  features?: DatasetDictOptions['features'];
  /** Field for stratified splitting (maintain class distribution) */
  stratifiedField?: DatasetDictOptions['stratifiedField'];
  // Dataset card metadata options
  /** License identifier for dataset card (e.g., "mit", "apache-2.0") */
  cardLicense?: string;
  /** Task categories for dataset card */
  cardTaskCategories?: string[];
  /** Language codes for dataset card */
  cardLanguage?: string[];
  /** Description for dataset card */
  cardDescription?: string;
}

// Re-export types and utilities
export * from './types';
export * from './registry';
export * from './utils';

// Export cleanup module
export { runCleanup } from './cleanup';
