/**
 * HuggingFace dataset utilities
 * Schema inference, feature mapping, splitting, and metadata generation
 */

import type { FeatureType } from '../types';
import { inferType, createSeededRandom, shuffleArray } from '../utils';

/**
 * HF Feature representation for dataset_info.json
 */
export interface HFFeature {
  dtype?: string;
  _type: string;
  feature?: HFFeature;
  [key: string]: unknown;
}

/**
 * Dataset info structure for HuggingFace compatibility
 */
export interface DatasetInfo {
  description?: string;
  features: Record<string, HFFeature>;
  splits: Array<{
    name: string;
    num_bytes: number;
    num_examples: number;
  }>;
  download_size: number;
  dataset_size: number;
}

/**
 * Infer HuggingFace schema from data by sampling records
 * Uses inferType from ../utils.ts then refines to HF-specific types
 */
export function inferHFSchema(data: unknown[]): Record<string, FeatureType> {
  if (data.length === 0) return {};

  const schema: Record<string, FeatureType> = {};
  const sampleSize = Math.min(data.length, 100);
  const step = Math.max(1, Math.floor(data.length / sampleSize));
  const samples = Array.from({ length: sampleSize }, (_, i) => data[i * step]);

  // Collect all field names across samples
  const fieldNames = new Set<string>();
  for (const record of samples) {
    if (typeof record === 'object' && record !== null) {
      for (const key of Object.keys(record)) {
        fieldNames.add(key);
      }
    }
  }

  for (const field of fieldNames) {
    const values = samples
      .map((r) => (r as Record<string, unknown>)[field])
      .filter((v) => v !== null && v !== undefined);

    if (values.length === 0) {
      schema[field] = 'string';
      continue;
    }

    schema[field] = inferFeatureType(values);
  }

  return schema;
}

/**
 * Infer a FeatureType from an array of non-null values
 */
function inferFeatureType(values: unknown[]): FeatureType {
  const baseType = inferType(values[0]);

  switch (baseType) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'bool';
    case 'number':
      return refineNumberType(values as number[]);
    case 'array': {
      // Infer element type from first non-empty array
      const firstArray = values.find((v) => Array.isArray(v) && (v as unknown[]).length > 0) as
        | unknown[]
        | undefined;
      if (firstArray) {
        const elementType = inferFeatureType(
          firstArray.filter((v) => v !== null && v !== undefined)
        );
        return { type: 'list', feature: elementType };
      }
      return { type: 'list', feature: 'string' };
    }
    case 'object': {
      // Infer nested fields
      const fields: Record<string, FeatureType> = {};
      const objValues = values.filter(
        (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
      ) as Record<string, unknown>[];

      const nestedKeys = new Set<string>();
      for (const obj of objValues) {
        for (const key of Object.keys(obj)) {
          nestedKeys.add(key);
        }
      }

      for (const key of nestedKeys) {
        const nestedValues = objValues
          .map((obj) => obj[key])
          .filter((v) => v !== null && v !== undefined);
        fields[key] = nestedValues.length > 0 ? inferFeatureType(nestedValues) : 'string';
      }

      return { type: 'dict', fields };
    }
    default:
      return 'string';
  }
}

/**
 * Refine a number type to int32/int64/float32/float64
 */
function refineNumberType(values: number[]): FeatureType {
  const allIntegers = values.every((v) => Number.isInteger(v));

  if (allIntegers) {
    // Check if fits in int32 range
    const fitsInt32 = values.every((v) => v >= -2147483648 && v <= 2147483647);
    return fitsInt32 ? 'int32' : 'int64';
  }

  // Check precision - float64 for very precise values
  const needsFloat64 = values.some((v) => {
    const asFloat32 = Math.fround(v);
    return Math.abs(v - asFloat32) > 1e-7 * Math.abs(v);
  });

  return needsFloat64 ? 'float64' : 'float32';
}

/**
 * Convert a FeatureType to HF dataset_info.json feature format
 */
export function featureTypeToHFFeature(ft: FeatureType): HFFeature {
  if (typeof ft === 'string') {
    switch (ft) {
      case 'string':
        return { dtype: 'string', _type: 'Value' };
      case 'int32':
        return { dtype: 'int32', _type: 'Value' };
      case 'int64':
        return { dtype: 'int64', _type: 'Value' };
      case 'float32':
        return { dtype: 'float32', _type: 'Value' };
      case 'float64':
        return { dtype: 'float64', _type: 'Value' };
      case 'bool':
        return { dtype: 'bool', _type: 'Value' };
      case 'binary':
        return { dtype: 'binary', _type: 'Value' };
      default:
        return { dtype: 'string', _type: 'Value' };
    }
  }

  if (ft.type === 'list') {
    return {
      feature: featureTypeToHFFeature(ft.feature),
      _type: 'Sequence',
    };
  }

  if (ft.type === 'dict') {
    const struct: Record<string, HFFeature> = {};
    for (const [key, value] of Object.entries(ft.fields)) {
      struct[key] = featureTypeToHFFeature(value);
    }
    return struct as unknown as HFFeature;
  }

  return { dtype: 'string', _type: 'Value' };
}

/**
 * Build complete features map for dataset_info.json
 */
export function buildFeaturesMap(schema: Record<string, FeatureType>): Record<string, HFFeature> {
  const features: Record<string, HFFeature> = {};
  for (const [key, ft] of Object.entries(schema)) {
    features[key] = featureTypeToHFFeature(ft);
  }
  return features;
}

/**
 * Stratified split maintaining class distribution
 * Splits data so each split has roughly the same proportion of each class
 */
export function stratifiedSplit<T>(
  data: T[],
  field: string,
  ratios: [number, number, number],
  seed?: number
): { train: T[]; validation: T[]; test: T[] } {
  const [trainRatio, valRatio, testRatio] = ratios;
  const sum = trainRatio + valRatio + testRatio;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Split ratios must sum to 1.0, got ${sum}`);
  }

  // Group by class
  const groups = new Map<string, T[]>();
  for (const item of data) {
    const record = item as Record<string, unknown>;
    const classValue = String(record[field] ?? 'unknown');
    if (!groups.has(classValue)) {
      groups.set(classValue, []);
    }
    groups.get(classValue)!.push(item);
  }

  const train: T[] = [];
  const validation: T[] = [];
  const test: T[] = [];
  const rng = seed !== undefined ? createSeededRandom(seed) : () => Math.random();

  // Split each class proportionally
  for (const [, items] of groups) {
    const shuffled = shuffleArray([...items], rng);

    const trainSize = Math.floor(shuffled.length * trainRatio);
    const valSize = Math.floor(shuffled.length * valRatio);

    train.push(...shuffled.slice(0, trainSize));
    validation.push(...shuffled.slice(trainSize, trainSize + valSize));
    test.push(...shuffled.slice(trainSize + valSize));
  }

  return { train, validation, test };
}

/**
 * Generate complete dataset_info.json content
 */
export function generateDatasetInfo(params: {
  description?: string;
  features: Record<string, FeatureType>;
  splits: Array<{ name: string; data: unknown[] }>;
}): DatasetInfo {
  const hfFeatures = buildFeaturesMap(params.features);

  const splitInfos = params.splits.map((split) => {
    const bytes = split.data.reduce<number>((sum, record) => {
      return sum + JSON.stringify(record).length;
    }, 0);
    return {
      name: split.name,
      num_bytes: bytes,
      num_examples: split.data.length,
    };
  });

  const totalBytes = splitInfos.reduce<number>((sum, s) => sum + s.num_bytes, 0);

  return {
    description: params.description,
    features: hfFeatures,
    splits: splitInfos,
    download_size: totalBytes,
    dataset_size: totalBytes,
  };
}

/**
 * Simple YAML serializer for dataset card frontmatter
 * No external dependency needed
 */
export function generateYAML(obj: Record<string, unknown>, indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}${key}: []`);
      } else if (typeof value[0] === 'object' && value[0] !== null) {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          const itemLines = generateYAML(item as Record<string, unknown>, indent + 1).split('\n');
          if (itemLines.length > 0) {
            lines.push(`${prefix}- ${itemLines[0].trimStart()}`);
            for (let i = 1; i < itemLines.length; i++) {
              if (itemLines[i].trim()) {
                lines.push(`${prefix}  ${itemLines[i].trimStart()}`);
              }
            }
          }
        }
      } else {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          lines.push(`${prefix}- ${formatYAMLValue(item)}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${prefix}${key}:`);
      lines.push(generateYAML(value as Record<string, unknown>, indent + 1));
    } else {
      lines.push(`${prefix}${key}: ${formatYAMLValue(value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a scalar value for YAML output
 */
function formatYAMLValue(value: unknown): string {
  if (typeof value === 'string') {
    // Quote strings that contain special YAML chars
    if (
      value.includes(':') ||
      value.includes('#') ||
      value.includes('{') ||
      value.includes('}') ||
      value.includes('[') ||
      value.includes(']') ||
      value.includes(',') ||
      value.includes('&') ||
      value.includes('*') ||
      value.includes('?') ||
      value.includes('|') ||
      value.includes('>') ||
      value.includes("'") ||
      value.includes('"') ||
      value.includes('%') ||
      value.includes('@') ||
      value.includes('`') ||
      value.trim() !== value ||
      value === '' ||
      value === 'true' ||
      value === 'false' ||
      value === 'null' ||
      !isNaN(Number(value))
    ) {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return String(value);
}

/**
 * Build a row for parquet writing, converting types appropriately
 * Shared between parquet.ts and datasetdict.ts
 */
export function buildParquetRow(
  record: Record<string, unknown>,
  schema: Record<string, FeatureType>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const field of Object.keys(schema)) {
    const value = record[field];
    const ft = schema[field];

    if (typeof ft !== 'string') {
      row[field] = value !== undefined ? JSON.stringify(value) : '';
    } else if (ft === 'bool') {
      row[field] = Boolean(value);
    } else if (ft === 'int32' || ft === 'int64') {
      const num = typeof value === 'number' ? value : Number(value);
      row[field] = Number.isNaN(num) ? 0 : Math.floor(num);
    } else if (ft === 'float32' || ft === 'float64') {
      const num = typeof value === 'number' ? value : Number(value);
      row[field] = Number.isNaN(num) ? 0 : num;
    } else {
      row[field] = value !== undefined && value !== null ? String(value) : '';
    }
  }

  return row;
}

/**
 * Map FeatureType to @dsnp/parquetjs schema type
 */
export function featureTypeToParquetType(ft: FeatureType): string {
  if (typeof ft === 'string') {
    switch (ft) {
      case 'string':
        return 'UTF8';
      case 'int32':
        return 'INT32';
      case 'int64':
        return 'INT64';
      case 'float32':
        return 'FLOAT';
      case 'float64':
        return 'DOUBLE';
      case 'bool':
        return 'BOOLEAN';
      case 'binary':
        return 'BYTE_ARRAY';
      default:
        return 'UTF8';
    }
  }

  // For complex types, serialize as JSON string
  return 'UTF8';
}
