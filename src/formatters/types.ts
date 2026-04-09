/**
 * Core types and interfaces for dataset formatters
 * Supports text/LLM, vision, audio, and HuggingFace dataset formats
 */

/**
 * Base formatter interface that all formatters must implement
 */
export interface Formatter<TOptions extends FormatOptions = FormatOptions> {
  /** Unique formatter name/identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Supported input formats */
  supportedInputFormats: string[];
  /** Whether this formatter handles its own train/val/test splitting internally */
  handlesOwnSplitting?: boolean;
  /** Validate input data for this formatter */
  validate(input: unknown[], options?: Partial<TOptions>): ValidationResult;
  /** Format the input data */
  format(input: unknown[], options: TOptions): Promise<FormattedOutput>;
}

/**
 * Base options for all formatters
 */
export interface FormatOptions {
  /** Input file path (alternative to inputData) */
  inputPath?: string;
  /** Input data array (alternative to inputPath) */
  inputData?: unknown[];
  /** Output directory path */
  outputDir: string;
  /** Formatter name */
  formatter: string;
  /** Field mapping configuration (input field -> template expression) */
  fieldMap: Record<string, string>;
  /** Split ratios for train/val/test (must sum to 1.0) */
  splitRatios?: [number, number, number];
  /** Random seed for reproducible splits */
  seed?: number;
  /** System prompt for chat-based formats */
  systemPrompt?: string;
  /** Dataset name for metadata */
  datasetName?: string;
  /** Whether to copy media files to output */
  copyMedia?: boolean;
  /** Field containing image paths (for vision formats) */
  imageField?: string;
  /** Field containing audio paths (for audio formats) */
  audioField?: string;
  /** Base path for resolving relative file paths */
  basePath?: string;
  /** Whether to generate dataset card */
  generateCard?: boolean;
  /** Custom output schema file path */
  schema?: string;
  /** Cleanup options */
  cleanup?: CleanupOptions;
}

/**
 * Result of validation
 */
export interface ValidationResult {
  /** Whether data is valid */
  valid: boolean;
  /** List of validation errors */
  errors: ValidationError[];
  /** Statistics about validation */
  stats?: {
    total: number;
    valid: number;
    invalid: number;
  };
}

/**
 * Individual validation error
 */
export interface ValidationError {
  /** Index of the record with error */
  index: number;
  /** Field that failed validation */
  field?: string;
  /** Error message */
  message: string;
  /** The invalid value (if applicable) */
  value?: unknown;
}

/**
 * Output from formatter
 */
export interface FormattedOutput {
  /** Path to output directory */
  outputDir: string;
  /** Paths to generated files by split */
  files: {
    train?: string[];
    validation?: string[];
    test?: string[];
    all?: string[];
  };
  /** Generated metadata */
  metadata: FormatMetadata;
}

/**
 * Metadata about the formatted dataset
 */
export interface FormatMetadata {
  /** Formatter name used */
  formatter: string;
  /** Dataset name */
  datasetName: string;
  /** Timestamp of formatting */
  timestamp: number;
  /** Total record count by split */
  counts: {
    train: number;
    validation: number;
    test: number;
    total: number;
    input?: number;
  };
  /** Statistics about the dataset */
  stats?: DatasetStats;
  /** Field mapping used */
  fieldMap?: Record<string, string>;
  /** Cleanup statistics if cleanup was performed */
  cleanup?: {
    enabled: boolean;
    removed: number;
    modified: number;
    stages?: unknown;
  };
}

/**
 * Dataset statistics
 */
export interface DatasetStats {
  /** Average record size in bytes */
  avgRecordSize?: number;
  /** Estimated total tokens (if applicable) */
  totalTokens?: number;
  /** Average tokens per record */
  avgTokensPerRecord?: number;
  /** Field-level statistics */
  fieldStats?: Record<string, FieldStats>;
}

/**
 * Statistics for a single field
 */
export interface FieldStats {
  /** Data type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  /** Number of non-null values */
  nonNull: number;
  /** Number of null/undefined values */
  nullCount: number;
  /** For strings: average length */
  avgLength?: number;
  /** For strings: min length */
  minLength?: number;
  /** For strings: max length */
  maxLength?: number;
  /** For numbers: average value */
  avg?: number;
  /** For numbers: min value */
  min?: number;
  /** For numbers: max value */
  max?: number;
}

/**
 * Quality score for a record
 */
export interface QualityScore {
  /** Record index */
  index: number;
  /** Quality score (1-10) */
  score: number;
  /** Reason for the score */
  reason?: string;
}

/**
 * Cleanup options for data preprocessing
 */
export interface CleanupOptions {
  /** Enable deduplication */
  dedupe?: boolean;
  /** Fields to use for deduplication (defaults to all) */
  dedupeFields?: string[];
  /** Enable field validation */
  validate?: boolean;
  /** Required fields that must be present */
  requiredFields?: string[];
  /** Enable LLM-based quality scoring */
  quality?: boolean;
  /** Minimum quality score (1-10) */
  qualityThreshold?: number;
  /** Minimum content length for text fields */
  minLength?: number;
  /** Maximum content length for text fields */
  maxLength?: number;
  /** Remove records with empty fields */
  removeEmpty?: boolean;
  /** Fields to check for file existence (image/audio paths) */
  validateFileFields?: string[];
  /** Base path for resolving relative file paths */
  basePath?: string;
}

/**
 * ChatML format specific options
 */
export interface ChatMLOptions extends FormatOptions {
  /** Role mapping for custom field names */
  roleMap?: {
    system?: string;
    user?: string;
    assistant?: string;
  };
  /** Field containing conversation ID for multi-turn */
  conversationIdField?: string;
  /** Whether to include system message */
  includeSystem?: boolean;
}

/**
 * Alpaca format specific options
 */
export interface AlpacaOptions extends FormatOptions {
  /** Default value for input field if not provided */
  defaultInput?: string;
  /** Whether to include empty input field */
  includeEmptyInput?: boolean;
}

/**
 * OASST (OpenAssistant) format specific options
 */
export interface OASSTOptions extends FormatOptions {
  /** Language code for all messages (e.g., "en") */
  lang?: string;
  /** Field containing the message tree ID */
  treeIdField?: string;
  /** Field containing the parent message ID */
  parentIdField?: string;
}

/**
 * ShareGPT format specific options
 */
export interface ShareGPTOptions extends FormatOptions {
  /** Field containing conversation turns */
  conversationField?: string;
  /** Mapping for human messages */
  humanField?: string;
  /** Mapping for bot/assistant messages */
  assistantField?: string;
}

/**
 * LLaVA format specific options
 */
export interface LLaVAOptions extends FormatOptions {
  /** Image placeholder token */
  imageToken?: string;
  /** Whether to embed images as base64 */
  embedImages?: boolean;
  /** Maximum image size for embedding (in bytes) */
  maxEmbedSize?: number;
}

/**
 * ImageFolder format specific options
 */
export interface ImageFolderOptions extends FormatOptions {
  /** Field containing class/category label */
  classField: string;
  /** Image file extensions to include */
  imageExtensions?: string[];
}

/**
 * COCO format specific options
 */
export interface COCOOptions extends FormatOptions {
  /** Field containing bounding boxes [x, y, width, height] */
  bboxField?: string;
  /** Field containing category ID */
  categoryIdField?: string;
  /** Field containing category name */
  categoryNameField?: string;
}

/**
 * YOLO format specific options
 */
export interface YOLOOptions extends FormatOptions {
  /** Field containing bounding boxes [x, y, width, height] (absolute COCO format) */
  bboxField?: string;
  /** Field containing class index */
  classField: string;
  /** Image width for normalization (if not in data) */
  imageWidth?: number;
  /** Image height for normalization (if not in data) */
  imageHeight?: number;
}

/**
 * COCO-Seg format specific options
 */
export interface COCOSegOptions extends FormatOptions {
  /** Field containing bounding boxes [x, y, width, height] */
  bboxField?: string;
  /** Field containing category name */
  categoryNameField?: string;
  /** Field containing mask file path */
  maskField?: string;
}

/**
 * YOLO-Seg format specific options
 */
export interface YOLOSegOptions extends FormatOptions {
  /** Field containing class/category name */
  classField: string;
  /** Field containing mask file path */
  maskField?: string;
}

/**
 * AudioFolder format specific options
 */
export interface AudioFolderOptions extends FormatOptions {
  /** Field containing class/category label */
  classField: string;
  /** Audio file extensions to include */
  audioExtensions?: string[];
}

/**
 * SpeechText format specific options
 */
export interface SpeechTextOptions extends FormatOptions {
  /** Field containing transcription text (default: "text") */
  textField?: string;
  /** Existing field name containing duration value */
  durationField?: string;
  /** Use ffprobe to extract audio duration */
  extractDuration?: boolean;
  /** Audio file extensions to include */
  audioExtensions?: string[];
}

/**
 * HuggingFace DatasetDict options
 */
export interface DatasetDictOptions extends FormatOptions {
  /** Output format: 'json' | 'parquet' */
  outputFormat?: 'json' | 'parquet';
  /** Features schema (auto-inferred if not provided) */
  features?: Record<string, FeatureType>;
  /** Field for stratified splitting (maintain class distribution) */
  stratifiedField?: string;
  /** License for dataset card */
  cardLicense?: string;
  /** Task categories for dataset card */
  cardTaskCategories?: string[];
  /** Language codes for dataset card */
  cardLanguage?: string[];
  /** Description for dataset card */
  cardDescription?: string;
}

/**
 * Parquet format options (same as DatasetDict)
 */
export type ParquetOptions = DatasetDictOptions;

/**
 * Feature type for HF datasets
 */
export type FeatureType =
  | 'string'
  | 'int32'
  | 'int64'
  | 'float32'
  | 'float64'
  | 'bool'
  | 'binary'
  | { type: 'list'; feature: FeatureType }
  | { type: 'dict'; fields: Record<string, FeatureType> };

/**
 * CSV+Images format specific options
 */
export interface CsvImagesOptions extends FormatOptions {
  /** Fields to include in output (defaults to all) */
  includeFields?: string[];
  /** Fields to exclude from output */
  excludeFields?: string[];
}

/**
 * Union of all format options
 */
export type AllFormatOptions =
  | FormatOptions
  | ChatMLOptions
  | AlpacaOptions
  | ShareGPTOptions
  | OASSTOptions
  | LLaVAOptions
  | ImageFolderOptions
  | CsvImagesOptions
  | COCOOptions
  | YOLOOptions
  | COCOSegOptions
  | YOLOSegOptions
  | AudioFolderOptions
  | SpeechTextOptions
  | DatasetDictOptions
  | ParquetOptions;

/**
 * Split data structure
 */
export interface SplitData<T> {
  train: T[];
  validation: T[];
  test: T[];
}

/**
 * Field value from path (supports nested paths like "meta.author.name")
 */
export type FieldValue = string | number | boolean | null | unknown;
