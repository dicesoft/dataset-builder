/**
 * Parquet formatter
 * Standalone Parquet output format for HuggingFace datasets
 * Requires @dsnp/parquetjs (optional dependency)
 */

import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, DatasetDictOptions } from '../types';
import { ensureDir, splitDataset, writeData, computeStatistics } from '../utils';
import {
  inferHFSchema,
  generateDatasetInfo,
  featureTypeToParquetType,
  stratifiedSplit,
  buildParquetRow,
} from './utils';
import { writeDatasetCard } from './card';

/**
 * Parquet formatter implementation
 * Handles its own splitting and writes .parquet files per split
 */
export class ParquetFormatter implements Formatter<DatasetDictOptions> {
  name = 'parquet';
  description = 'Apache Parquet format for HuggingFace datasets (requires @dsnp/parquetjs)';
  supportedInputFormats = ['json', 'jsonl', 'csv'];
  handlesOwnSplitting = true;

  /**
   * Validate input data and check for @dsnp/parquetjs availability
   */
  validate(input: unknown[], _options?: Partial<DatasetDictOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    if (input.length === 0) {
      errors.push({
        index: 0,
        message: 'Input data is empty',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      stats: {
        total: input.length,
        valid: input.length,
        invalid: 0,
      },
    };
  }

  /**
   * Format data to Parquet files
   */
  async format(input: unknown[], options: DatasetDictOptions): Promise<FormattedOutput> {
    // Check for parquetjs availability early
    let parquetjs: typeof import('@dsnp/parquetjs');
    try {
      parquetjs = await import('@dsnp/parquetjs');
    } catch {
      throw new Error(
        'Parquet format requires @dsnp/parquetjs. Install it with: npm install @dsnp/parquetjs'
      );
    }

    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    // Infer or use provided schema
    const schema = options.features || inferHFSchema(input);

    // Handle splitting internally
    const splitRatios = options.splitRatios;
    let splits: { train: unknown[]; validation: unknown[]; test: unknown[] };

    if (splitRatios) {
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

    // Write each non-empty split
    for (const [splitName, splitData] of Object.entries(splits)) {
      if ((splitData as unknown[]).length === 0) continue;

      const splitDir = path.join(outputDir, splitName);
      await ensureDir(splitDir);

      const outputPath = path.join(splitDir, 'data-00000-of-00001.parquet');
      const writer = await parquetjs.ParquetWriter.openFile(pqSchema, outputPath);

      for (const record of splitData as unknown[]) {
        const row = buildParquetRow(record as Record<string, unknown>, schema);
        await writer.appendRow(row);
      }

      await writer.close();
      allFiles.push(outputPath);
      splitInfos.push({ name: splitName, data: splitData as unknown[] });
    }

    // Generate dataset_info.json
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
        tags: ['huggingface', 'parquet'],
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
 * Parquet formatter instance
 */
export const parquetFormatter = new ParquetFormatter();

/**
 * Convenience function to format data
 */
export async function formatToParquet(
  data: unknown[],
  outputDir: string,
  options?: Partial<DatasetDictOptions>
): Promise<FormattedOutput> {
  const formatter = new ParquetFormatter();
  const fullOptions: DatasetDictOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'parquet',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
