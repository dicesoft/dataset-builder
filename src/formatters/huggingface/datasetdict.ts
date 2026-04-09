/**
 * HuggingFace DatasetDict formatter
 * Produces HF-compatible directory structure with dataset_info.json
 * Supports JSON (default) and Parquet output formats
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, DatasetDictOptions } from '../types';
import { ensureDir, writeData, estimateTokens, splitDataset, computeStatistics } from '../utils';
import {
  inferHFSchema,
  generateDatasetInfo,
  stratifiedSplit,
  buildParquetRow,
  featureTypeToParquetType,
} from './utils';
import { writeDatasetCard } from './card';

/**
 * DatasetDict formatter implementation
 * Handles its own splitting to produce root-level dataset_info.json
 */
export class DatasetDictFormatter implements Formatter<DatasetDictOptions> {
  name = 'datasetdict';
  description = 'HuggingFace DatasetDict format with dataset_info.json (JSON or Parquet)';
  supportedInputFormats = ['json', 'jsonl', 'csv'];
  handlesOwnSplitting = true;

  /**
   * Validate input data
   */
  validate(input: unknown[], options?: Partial<DatasetDictOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    if (input.length === 0) {
      errors.push({
        index: 0,
        message: 'Input data is empty',
      });
    }

    // Validate outputFormat
    if (options?.outputFormat && !['json', 'parquet'].includes(options.outputFormat)) {
      errors.push({
        index: 0,
        message: `Unsupported output format: "${options.outputFormat}". Use "json" (default) or "parquet".`,
      });
    }

    // If features specified, validate they exist in data
    if (options?.features && input.length > 0) {
      const sampleRecord = input[0] as Record<string, unknown>;
      for (const field of Object.keys(options.features)) {
        if (!(field in sampleRecord)) {
          errors.push({
            index: 0,
            field,
            message: `Specified feature "${field}" not found in data`,
          });
        }
      }
    }

    const validCount =
      input.length - errors.filter((e) => e.index !== 0 || input.length === 0).length;

    return {
      valid: errors.length === 0,
      errors,
      stats: {
        total: input.length,
        valid: errors.length === 0 ? input.length : validCount,
        invalid: errors.length === 0 ? 0 : input.length - validCount,
      },
    };
  }

  /**
   * Format data to HuggingFace DatasetDict structure
   * Handles splitting internally
   */
  async format(input: unknown[], options: DatasetDictOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const outputFormat = options.outputFormat || 'json';

    // Infer or use provided schema
    const schema = options.features || inferHFSchema(input);

    // Handle splitting internally
    const splitRatios = options.splitRatios;
    let splits: { train: unknown[]; validation: unknown[]; test: unknown[] };

    if (splitRatios) {
      // Check for stratified field in options
      const stratifiedField = options.stratifiedField;
      if (stratifiedField) {
        splits = stratifiedSplit(input, stratifiedField, splitRatios, options.seed);
      } else {
        splits = splitDataset(input, splitRatios, options.seed);
      }
    } else {
      splits = { train: input, validation: [], test: [] };
    }

    const allFiles: string[] = [];
    const splitInfos: Array<{ name: string; data: unknown[] }> = [];

    // Write each non-empty split
    for (const [splitName, splitData] of Object.entries(splits)) {
      if ((splitData as unknown[]).length === 0) continue;

      const splitDir = path.join(outputDir, splitName);
      await ensureDir(splitDir);

      if (outputFormat === 'parquet') {
        // Dynamic import parquet writing
        const files = await writeParquetSplit(splitDir, splitData as unknown[], schema);
        allFiles.push(...files);
      } else {
        // JSON output
        const jsonPath = path.join(splitDir, 'data-00000-of-00001.json');
        await writeData(jsonPath, splitData, true);
        allFiles.push(jsonPath);

        // Also write JSONL for convenience
        const jsonlPath = path.join(splitDir, 'data-00000-of-00001.jsonl');
        const jsonlContent = (splitData as unknown[]).map((r) => JSON.stringify(r)).join('\n');
        await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
        allFiles.push(jsonlPath);
      }

      splitInfos.push({ name: splitName, data: splitData as unknown[] });
    }

    // Generate dataset_info.json at root level
    const datasetInfo = generateDatasetInfo({
      description: options.datasetName || 'dataset',
      features: schema,
      splits: splitInfos,
    });
    const infoPath = path.join(outputDir, 'dataset_info.json');
    await writeData(infoPath, datasetInfo, true);
    allFiles.push(infoPath);

    // Compute statistics
    const dataStats = computeStatistics(input);
    const totalTokens = dataStats.totalTokens || 0;

    // Generate dataset card if requested
    if (options.generateCard) {
      const cardPath = await writeDatasetCard(outputDir, {
        datasetName: options.datasetName || 'dataset',
        description: options.cardDescription,
        license: options.cardLicense,
        taskCategories: options.cardTaskCategories,
        language: options.cardLanguage,
        features: schema,
        splits: splitInfos.map((s) => ({
          name: s.name,
          numExamples: s.data.length,
          numBytes: s.data.reduce<number>((sum, r) => sum + JSON.stringify(r).length, 0),
        })),
        totalExamples: input.length,
        formatter: this.name,
        tags: ['huggingface', outputFormat],
        fieldStats: dataStats.fieldStats,
      });
      allFiles.push(cardPath);
    }

    return {
      outputDir,
      files: {
        all: allFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'dataset',
        timestamp: Date.now(),
        counts: {
          train: splits.train.length,
          validation: splits.validation.length,
          test: splits.test.length,
          total: input.length,
        },
        stats: {
          ...dataStats,
          totalTokens,
          avgTokensPerRecord: input.length > 0 ? Math.ceil(totalTokens / input.length) : 0,
        },
      },
    };
  }
}

/**
 * Write a split as parquet files
 * Uses dynamic import for @dsnp/parquetjs
 */
async function writeParquetSplit(
  splitDir: string,
  data: unknown[],
  schema: Record<string, import('../types').FeatureType>
): Promise<string[]> {
  try {
    const parquetjs = await import('@dsnp/parquetjs');

    // Build parquet schema
    const schemaFields: Record<string, { type: string }> = {};
    for (const [field, ft] of Object.entries(schema)) {
      if (typeof ft !== 'string') {
        schemaFields[field] = { type: 'UTF8' };
      } else {
        schemaFields[field] = { type: featureTypeToParquetType(ft) };
      }
    }

    const pqSchema = new parquetjs.ParquetSchema(
      schemaFields as Record<string, import('@dsnp/parquetjs').FieldDefinition>
    );
    const outputPath = path.join(splitDir, 'data-00000-of-00001.parquet');
    const writer = await parquetjs.ParquetWriter.openFile(pqSchema, outputPath);

    for (const record of data) {
      const row = buildParquetRow(record as Record<string, unknown>, schema);
      await writer.appendRow(row);
    }

    await writer.close();
    return [outputPath];
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Cannot find module') || error.message.includes('MODULE_NOT_FOUND'))
    ) {
      throw new Error(
        'Parquet output requires @dsnp/parquetjs. Install it with: npm install @dsnp/parquetjs'
      );
    }
    throw error;
  }
}

/**
 * DatasetDict formatter instance
 */
export const datasetdictFormatter = new DatasetDictFormatter();

/**
 * Convenience function to format data
 */
export async function formatToDatasetDict(
  data: unknown[],
  outputDir: string,
  options?: Partial<DatasetDictOptions>
): Promise<FormattedOutput> {
  const formatter = new DatasetDictFormatter();
  const fullOptions: DatasetDictOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'datasetdict',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
