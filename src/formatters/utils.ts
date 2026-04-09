/**
 * Utility functions for dataset formatting
 * Field mapping, data splitting, validation helpers
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createInterface } from 'readline';
import { safeJsonParse } from '../utils/json';
import { CLIError, ErrorCodes } from '../utils/errorCodes';
import { ExitCode } from '../utils/exitCodes';
import type {
  FieldValue,
  SplitData,
  FormatOptions,
  ValidationResult,
  ValidationError,
  FieldStats,
  DatasetStats,
} from './types';

/**
 * Get a nested field value from an object using dot notation path
 * Supports paths like "meta.author.name" or "items[0].title"
 * @param obj - Object to extract value from
 * @param path - Dot-notation path
 * @returns The value at the path, or undefined if not found
 */
export function getFieldValue(obj: Record<string, unknown>, fieldPath: string): FieldValue {
  if (!obj || typeof obj !== 'object') return undefined;
  if (!fieldPath) return undefined;

  const parts = fieldPath.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    // Handle array indexing like "items[0]"
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, prop, index] = arrayMatch;
      const arr = (current as Record<string, unknown>)[prop];
      if (!Array.isArray(arr)) return undefined;
      current = arr[parseInt(index, 10)];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current as FieldValue;
}

/**
 * Set a nested field value using dot notation path
 * Creates intermediate objects if they don't exist
 * @param obj - Object to set value in
 * @param fieldPath - Dot-notation path
 * @param value - Value to set
 */
export function setFieldValue(
  obj: Record<string, unknown>,
  fieldPath: string,
  value: unknown
): void {
  const parts = fieldPath.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Apply field mapping to a single record
 * Supports template expressions like "{{title}}" and "{{meta.author.name}}"
 * @param record - Input record
 * @param fieldMap - Mapping of output field -> template expression
 * @returns Mapped record
 */
export function applyFieldMap(
  record: Record<string, unknown>,
  fieldMap: Record<string, string>
): Record<string, unknown> {
  // If fieldMap is empty, return record unchanged
  if (!fieldMap || Object.keys(fieldMap).length === 0) {
    return record;
  }

  const result: Record<string, unknown> = {};

  for (const [outputField, template] of Object.entries(fieldMap)) {
    if (typeof template !== 'string') {
      result[outputField] = template;
      continue;
    }

    // Replace {{field.path}} with actual values
    const value = template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const fieldValue = getFieldValue(record, path.trim());
      return fieldValue !== undefined && fieldValue !== null ? String(fieldValue) : '';
    });

    result[outputField] = value;
  }

  return result;
}

/**
 * Apply field mapping to entire dataset
 * @param data - Array of records
 * @param fieldMap - Field mapping configuration
 * @returns Mapped data
 */
export function applyFieldMapToDataset(
  data: unknown[],
  fieldMap: Record<string, string>
): Record<string, unknown>[] {
  // If fieldMap is empty, return data as-is
  if (!fieldMap || Object.keys(fieldMap).length === 0) {
    return data as Record<string, unknown>[];
  }
  return data.map((record) => applyFieldMap(record as Record<string, unknown>, fieldMap));
}

/**
 * Seeded random number generator for reproducible splits
 * Uses xorshift algorithm
 * @param seed - Random seed
 * @returns Random number generator function
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296) % 1;
  };
}

/**
 * Fisher-Yates shuffle with seeded random
 * @param array - Array to shuffle
 * @param random - Random function from createSeededRandom
 * @returns Shuffled array (mutates input)
 */
export function shuffleArray<T>(array: T[], random: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Split dataset into train/validation/test sets
 * @param data - Array of records
 * @param ratios - [train, validation, test] ratios (must sum to 1.0)
 * @param seed - Random seed for reproducibility
 * @returns Split data
 */
export function splitDataset<T>(
  data: T[],
  ratios: [number, number, number] = [0.8, 0.1, 0.1],
  seed?: number
): SplitData<T> {
  const [trainRatio, valRatio, testRatio] = ratios;
  const sum = trainRatio + valRatio + testRatio;

  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Split ratios must sum to 1.0, got ${sum}`);
  }

  if (data.length === 0) {
    return { train: [], validation: [], test: [] };
  }

  // Create a copy and shuffle
  const shuffled =
    seed !== undefined ? shuffleArray([...data], createSeededRandom(seed)) : [...data];

  const total = shuffled.length;
  const trainSize = Math.floor(total * trainRatio);
  const valSize = Math.floor(total * valRatio);

  return {
    train: shuffled.slice(0, trainSize),
    validation: shuffled.slice(trainSize, trainSize + valSize),
    test: shuffled.slice(trainSize + valSize),
  };
}

/**
 * Parse split ratios from string like "80:10:10" or "0.8:0.1:0.1"
 * @param str - Ratio string
 * @returns Tuple of [train, validation, test] as decimals
 */
export function parseSplitRatios(str: string): [number, number, number] {
  const parts = str.split(':').map((p) => parseFloat(p.trim()));

  if (parts.length !== 3 || parts.some((p) => isNaN(p))) {
    throw new Error(`Invalid split format: "${str}". Expected format: "80:10:10" or "0.8:0.1:0.1"`);
  }

  // If values sum to ~100, treat as percentages
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum > 50) {
    return parts.map((p) => p / 100) as [number, number, number];
  }

  return parts as [number, number, number];
}

/**
 * Compute hash for deduplication
 * @param obj - Object to hash
 * @returns SHA-256 hash string
 */
export function computeHash(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Validate that required fields exist in data
 * @param data - Array of records
 * @param requiredFields - List of required field paths
 * @returns Validation result
 */
export function validateRequiredFields(
  data: unknown[],
  requiredFields: string[]
): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of requiredFields) {
      const value = getFieldValue(record, field);
      if (value === undefined || value === null || value === '') {
        errors.push({
          index: i,
          field,
          message: `Required field "${field}" is missing or empty`,
          value,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate file references exist on disk
 * @param data - Array of records
 * @param fileFields - Fields containing file paths
 * @param basePath - Base path for resolving relative paths
 * @returns Validation result
 */
export async function validateFileReferences(
  data: unknown[],
  fileFields: string[],
  basePath?: string
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of fileFields) {
      const filePath = getFieldValue(record, field) as string | undefined;

      if (!filePath) continue; // Skip if field is empty

      const fullPath = basePath ? path.resolve(basePath, filePath) : path.resolve(filePath);

      try {
        await fs.access(fullPath);
      } catch {
        errors.push({
          index: i,
          field,
          message: `File not found: ${filePath}`,
          value: filePath,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Infer the data type of a value
 * @param value - Value to check
 * @returns Inferred type
 */
export function inferType(value: unknown): FieldStats['type'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Compute statistics for a dataset
 * @param data - Array of records
 * @returns Dataset statistics
 */
export function computeStatistics(data: unknown[]): DatasetStats {
  if (data.length === 0) {
    return {
      avgRecordSize: 0,
      totalTokens: 0,
      avgTokensPerRecord: 0,
      fieldStats: {},
    };
  }

  // Collect all field names
  const fieldNames = new Set<string>();
  data.forEach((record) => {
    if (typeof record === 'object' && record !== null) {
      Object.keys(record).forEach((k) => fieldNames.add(k));
    }
  });

  // Compute field stats
  const fieldStats: Record<string, FieldStats> = {};

  for (const field of fieldNames) {
    const values = data.map((r) => (r as Record<string, unknown>)?.[field]);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined);
    const stringValues = nonNullValues.filter((v) => typeof v === 'string') as string[];
    const numberValues = nonNullValues.filter((v) => typeof v === 'number') as number[];

    const stats: FieldStats = {
      type: inferType(nonNullValues[0]),
      nonNull: nonNullValues.length,
      nullCount: values.length - nonNullValues.length,
    };

    if (stringValues.length > 0) {
      const lengths = stringValues.map((s) => s.length);
      stats.minLength = Math.min(...lengths);
      stats.maxLength = Math.max(...lengths);
      stats.avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    }

    if (numberValues.length > 0) {
      stats.min = Math.min(...numberValues);
      stats.max = Math.max(...numberValues);
      stats.avg = numberValues.reduce((a, b) => a + b, 0) / numberValues.length;
    }

    fieldStats[field] = stats;
  }

  // Compute record sizes and token estimates
  const sizes = data.map((r) => JSON.stringify(r).length);
  const avgRecordSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

  // Rough token estimation: ~4 characters per token
  const totalTokens = Math.ceil(sizes.reduce((a, b) => a + b, 0) / 4);
  const avgTokensPerRecord = Math.ceil(avgRecordSize / 4);

  return {
    avgRecordSize,
    totalTokens,
    avgTokensPerRecord,
    fieldStats,
  };
}

/**
 * Estimate token count for text (rough approximation)
 * Uses ~4 characters per token as a rough estimate
 * @param text - Text to estimate
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/** Size threshold (100 MB) above which a warning is emitted for JSON files */
const JSON_SIZE_WARNING_BYTES = 100 * 1024 * 1024;

/**
 * Known data file names to look for when a directory is passed as input.
 * Ordered by priority — the first match wins.
 */
const KNOWN_DATA_FILES = [
  'classified.json',
  'transformed.json',
  'sanitized.json',
  'downloaded.json',
  'imported.json',
  'data.json',
  'dataset.json',
  'records.json',
  'classified.jsonl',
  'transformed.jsonl',
  'sanitized.jsonl',
  'downloaded.jsonl',
  'imported.jsonl',
  'data.jsonl',
  'dataset.jsonl',
  'records.jsonl',
];

/**
 * Resolve a directory path to a known data file inside it.
 * Returns the resolved file path, or null if no known file is found.
 */
export async function resolveDirectoryInput(dirPath: string): Promise<string | null> {
  for (const name of KNOWN_DATA_FILES) {
    const candidate = path.join(dirPath, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

/**
 * Load data from file (JSON, JSONL, or CSV)
 * For JSONL files, uses streaming (readline + createReadStream) for better memory efficiency.
 * For JSON files larger than 100 MB, emits a warning to stderr.
 * If a directory is passed, auto-resolves to a known data file inside it.
 * @param filePath - Path to input file
 * @returns Array of records
 */
export async function loadData(filePath: string): Promise<unknown[]> {
  // Check if the path is a directory
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const resolved = await resolveDirectoryInput(filePath);
      if (resolved) {
        return loadData(resolved);
      }
      throw new CLIError(
        ErrorCodes.INVALID_INPUT,
        `Input is a directory. No known data file found in "${filePath}". Specify a file: -i ${path.join(filePath, 'classified.json')}`,
        ExitCode.INVALID_INPUT
      );
    }
  } catch (err) {
    // Re-throw CLIError, ignore ENOENT (file-not-found handled below by extension check)
    if (err instanceof CLIError) throw err;
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.jsonl') {
    return loadJsonlStreaming(filePath);
  }

  if (ext === '.json') {
    const stat = await fs.stat(filePath);
    if (stat.size > JSON_SIZE_WARNING_BYTES) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      console.warn(
        `Warning: JSON file is ${sizeMB} MB. Large JSON files are loaded entirely into memory. Consider using JSONL format for better performance.`
      );
    }
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = safeJsonParse(content, 'formatter data file');
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  if (ext === '.csv') {
    const content = await fs.readFile(filePath, 'utf-8');
    // Simple CSV parsing (header-based)
    const lines = content.split('\n').filter((line) => line.trim());
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const record: Record<string, string> = {};
      headers.forEach((h, i) => {
        record[h] = values[i] || '';
      });
      return record;
    });
  }

  throw new Error(`Unsupported file format: ${ext}`);
}

/**
 * Stream-load a JSONL file line-by-line using readline + createReadStream.
 * Builds the result array incrementally without reading the entire file into a single string.
 */
async function loadJsonlStreaming(filePath: string): Promise<unknown[]> {
  const results: unknown[] = [];
  let lineNumber = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();
    if (trimmed === '') continue;

    try {
      results.push(JSON.parse(trimmed));
    } catch {
      throw new CLIError(
        ErrorCodes.INVALID_INPUT,
        `Invalid JSON in formatter data file at line ${lineNumber}: failed to parse content`,
        ExitCode.INVALID_INPUT
      );
    }
  }

  return results;
}

/**
 * Write data to file in appropriate format
 * @param filePath - Output path
 * @param data - Data to write
 * @param pretty - Whether to pretty-print JSON
 */
export async function writeData(filePath: string, data: unknown, pretty = false): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();

  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (ext === '.jsonl') {
    const lines = (data as unknown[]).map((item) => JSON.stringify(item)).join('\n');
    await fs.writeFile(filePath, lines, 'utf-8');
  } else if (ext === '.csv') {
    await writeCSV(filePath, data as Record<string, unknown>[]);
  } else {
    // JSON
    const output = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await fs.writeFile(filePath, output, 'utf-8');
  }
}

/**
 * Write data as CSV
 * @param filePath - Output path
 * @param data - Array of records
 */
async function writeCSV(filePath: string, data: Record<string, unknown>[]): Promise<void> {
  if (data.length === 0) {
    await fs.writeFile(filePath, '', 'utf-8');
    return;
  }

  // Get all unique keys
  const keys = Array.from(new Set(data.flatMap((item) => Object.keys(item))));

  // Header
  const header = keys.join(',');

  // Rows
  const rows = data.map((item) => {
    return keys
      .map((key) => {
        const value = item[key];
        const str = value === undefined || value === null ? '' : String(value);
        // Escape quotes and wrap if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',');
  });

  const csv = [header, ...rows].join('\n');
  await fs.writeFile(filePath, csv, 'utf-8');
}

/**
 * Ensure output directory exists
 * @param dirPath - Directory path
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Copy file from source to destination
 * @param src - Source path
 * @param dest - Destination path
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

/**
 * Read file as base64
 * @param filePath - Path to file
 * @returns Base64 encoded string
 */
export async function fileToBase64(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return content.toString('base64');
}

/**
 * Get file extension in lowercase
 * @param filePath - File path
 * @returns Extension without dot
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase().slice(1);
}

/**
 * Check if file exists
 * @param filePath - File path
 * @returns True if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
