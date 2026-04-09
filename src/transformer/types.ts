/**
 * Transform types for converting scraped data to formatter-ready records
 */

import { AssetRecord, AssetManifest } from '../downloader/types';
import type { TransformDecisionLog } from './decision-log';

/** Input types for transform command */
export type TransformInputType = 'manifest' | 'scraped' | 'task-folder' | 'auto';

/** Available transform templates */
export type TransformTemplateType =
  | 'raw-extract'
  | 'text-instruct'
  | 'text-qa'
  | 'text-conversation'
  | 'image-classification'
  | 'image-captioning'
  | 'vision-qa'
  | 'audio-classification'
  | 'object-detection'
  | 'segmentation';

/** Transform options from CLI */
export interface TransformOptions {
  /** Input file or directory path */
  input: string;
  /** Transform template to use */
  template: TransformTemplateType;
  /** Output file path */
  output?: string;
  /** LLM/Vision model to use */
  model?: string;
  /** Target topic for relevance scoring */
  target?: string;
  /** Directory containing downloaded assets */
  assetDir?: string;
  /** Minimum relevance score to keep (0-1) */
  relevanceThreshold: number;
  /** LLM batch size */
  batchSize: number;
  /** Minimum text length */
  minTextLength: number;
  /** Maximum text length */
  maxTextLength: number;
  /** Skip LLM calls, use deterministic only */
  noLlm: boolean;
  /** Whether user explicitly passed a --model flag */
  explicitModel?: boolean;
  /** Deduplicate output */
  dedupe: boolean;
  /** Skip confirmation prompt */
  yes: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Resume from checkpoint */
  resume?: boolean;
  /** Force overwrite existing output */
  force?: boolean;
  /** Never use deterministic fallback — skip failed records */
  noFallback?: boolean;
  /** Number of retries per LLM/vision call before giving up (default: 3) */
  retries?: number;
  /** Disable VLLM thinking mode for faster output */
  noThink?: boolean;
  /** Enable/disable transform decision log output (default: true) */
  log?: boolean;
  /** User-provided labels to constrain classification (--labels) */
  labels?: string[];
  /** Auto-discover labels from data (--auto-labels) */
  autoLabels?: boolean;
  /** Number of images to sample for auto-label discovery (--auto-labels-count) */
  autoLabelsCount?: number;
  /** Internal: decision log instance threaded through the pipeline */
  _decisionLog?: TransformDecisionLog;
}

/** Checkpoint for resumable transform operations */
export interface TransformCheckpoint {
  taskId: string;
  inputPath: string;
  template: TransformTemplateType;
  options: TransformOptions;
  totalRecords: number;
  completedRecordIds: string[];
  failedRecordIds: string[];
  outputPath: string;
  partialResults: TransformRecord[];
  startedAt: string;
  lastUpdatedAt: string;
}

/** Filter reason breakdown */
export interface FilterReasons {
  /** Invalid URL (not starting with http) */
  invalidUrl: number;
  /** Invalid title (less than 3 chars) */
  invalidTitle: number;
  /** Text too short */
  textTooShort: number;
  /** Text too long */
  textTooLong: number;
  /** Non-word characters ratio too high */
  lowWordRatio: number;
  /** Missing or empty text */
  missingText: number;
}

/** Breakdown of reasons records were dropped from the pipeline */
export interface DropReasons {
  /** No classification result returned */
  no_classification?: number;
  /** Relevance score below threshold */
  below_threshold?: number;
  /** No fallback available / noFallback mode */
  no_fallback?: number;
  /** Dropped by quality filter */
  quality_filtered?: number;
  /** Empty or too-short caption/output */
  empty_output?: number;
  /** Vision/LLM generation failed */
  generation_failed?: number;
  /** Asset file not found on disk */
  file_not_found?: number;
}

/** Breakdown of reasons records used deterministic fallback instead of VLLM */
export interface FallbackReasons {
  /** VLLM failed to classify — fell back to deterministic */
  vllm_failed?: number;
  /** Image format not supported by vision model */
  unsupported_format?: number;
  /** Generation failed — fell back to deterministic */
  generation_failed?: number;
  [key: string]: number | undefined;
}

/** Transform statistics */
export interface TransformStats {
  /** Total input records */
  inputCount: number;
  /** Number of completed input records (from manifest status) */
  completedInputCount?: number;
  /** Number of failed input records (from manifest status) */
  failedInputCount?: number;
  /** Records filtered by deterministic rules */
  filteredCount: number;
  /** Breakdown of filter reasons */
  filterReasons?: FilterReasons;
  /** Records classified (scored for relevance) */
  classifiedCount: number;
  /** Records that passed relevance threshold */
  relevantCount: number;
  /** Records with generated content */
  generatedCount: number;
  /** Records dropped due to generation failure (e.g., LLM returned no result) */
  generationFailedCount?: number;
  /** Records dropped due to quality filtering */
  qualityFilteredCount?: number;
  /** Records that fell back to deterministic generation (VLLM skipped) */
  visionFallbackCount?: number;
  /** Records skipped due to unsupported image format */
  unsupportedFormatCount?: number;
  /** Per-extension breakdown of unsupported format counts (e.g., { '.gif': 24, '.webp': 10 }) */
  formatBreakdown?: Record<string, number>;
  /** Final output record count */
  outputCount: number;
  /** Records skipped due to errors */
  errorCount: number;
  /** Records skipped because LLM/VLLM failed (no-fallback mode) */
  skippedCount?: number;
  /** Processing was stopped early (abort, consecutive failures) */
  abortedEarly?: boolean;
  /** Breakdown of reasons records were dropped */
  dropReasons?: DropReasons;
  /** Breakdown of reasons records used deterministic fallback instead of VLLM */
  fallbackReasons?: FallbackReasons;
  /** Breakdown of LLM generation failure types */
  generationFailureBreakdown?: {
    emptyResponse: number;
    jsonParseError: number;
    idMismatch: number;
  };
  /** Relevance threshold used for filtering (if applicable) */
  relevanceThreshold?: number;
  /** Processing duration in milliseconds */
  duration: number;
  /** Total time spent in the generation/processing stage (ms) */
  generationDuration?: number;
  /** Average duration per generated record (ms) */
  avgRecordDuration?: number;
}

/** Progress callback data */
export interface TransformProgress {
  /** Total records to process */
  total: number;
  /** Records completed so far */
  completed: number;
  /** Current stage name */
  stage: string;
  /** Current status message */
  message: string;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
}

/** Transform result */
export interface TransformResult {
  /** Transformed records */
  records: unknown[];
  /** Processing statistics */
  stats: TransformStats;
  /** Path to the decision log file, if written */
  decisionLogPath?: string;
  /** Labels discovered by --auto-labels (if used) */
  discoveredLabels?: string[];
}

/** Template interface that all transform templates implement */
export interface TransformTemplate {
  /** Template name */
  name: TransformTemplateType;
  /** Human-readable description */
  description: string;
  /** Input types this template supports */
  supportedInputs: ('text' | 'image' | 'audio')[];
  /** Whether this template requires LLM */
  requiresLlm: boolean;
  /** Whether this template uses vision models */
  usesVision: boolean;
  /**
   * Process records through this template
   * @param records Input records (scraped pages or asset records)
   * @param options Transform options
   * @param progressCb Optional progress callback
   */
  process(
    records: unknown[],
    options: TransformOptions,
    progressCb?: (progress: TransformProgress) => void
  ): Promise<TransformResult>;
}

/** Scraped page data structure */
export interface ScrapedPage {
  id: string;
  source_url: string;
  title: string;
  text: string;
  links: string[];
  files?: string[];
  crawled_at: string;
  depth: number;
}

/** Combined scraped data structure */
export interface ScrapedCombined {
  taskId: string;
  searchQuery: string;
  generatedAt: string;
  pages: ScrapedPage[];
}

/** Metadata for traceability in output records */
export interface TransformMeta {
  /** Original source URL */
  sourceUrl: string;
  /** Source page title */
  sourceTitle?: string;
  /** Asset ID if from manifest */
  assetId?: string;
  /** Transform template used */
  template: TransformTemplateType;
  /** Relevance score if calculated */
  relevanceScore?: number;
  /** Whether record passed relevance check */
  isRelevant?: boolean;
  /** Processing timestamp */
  processedAt: string;
  /** How the record was generated */
  generationMethod?: 'llm' | 'deterministic' | 'hybrid';
  /** How the label was determined */
  labelSource?: 'vllm' | 'user_labels' | 'auto_discovered' | 'deterministic';
}

/** Extended transform record with metadata */
export interface TransformRecord {
  [key: string]: unknown;
  _meta: TransformMeta;
}

/** Relevance score result */
export interface RelevanceScore {
  score: number;
  relevant: boolean;
  reason: string;
}

/** Generated Q&A pair */
export interface QAPair {
  instruction: string;
  output: string;
}

/** Generated conversation turn */
export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Image classification result */
export interface ImageClassification {
  label: string;
  relevance: number;
  caption: string;
  reason: string;
}

/** Audio classification result */
export interface AudioClassification {
  label: string;
  confidence: number;
  description: string;
}

/** Object detection result from YOLO or VLLM */
export interface ObjectDetection {
  objects: Array<{
    label: string;
    bbox: [number, number, number, number]; // COCO absolute [x, y, w, h]
    confidence: number;
  }>;
  image_width: number;
  image_height: number;
}

/** Segmentation result from SAM */
export interface SegmentationResult {
  masks: Array<{
    label: string;
    mask_path: string;
    area: number;
    bbox: [number, number, number, number]; // COCO absolute [x, y, w, h]
  }>;
  image_width: number;
  image_height: number;
}

/** Export all downloader types for convenience */
export { AssetRecord, AssetManifest };
