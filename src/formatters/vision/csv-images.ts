/**
 * CSV+Images formatter
 * Simple metadata CSV with image_path column + data.json + data.jsonl
 * Suitable for generic vision datasets with metadata
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  Formatter,
  FormatOptions,
  ValidationResult,
  FormattedOutput,
  CsvImagesOptions,
} from '../types';
import { ensureDir, writeData } from '../utils';
import { resolveImagePath, copyImage, DEFAULT_IMAGE_EXTENSIONS } from './utils';

/**
 * CSV+Images formatter implementation
 */
export class CsvImagesFormatter implements Formatter<CsvImagesOptions> {
  name = 'csv-images';
  description = 'CSV metadata with associated image paths';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for CSV+Images format
   * Requires image field to be present
   */
  validate(input: unknown[], options?: Partial<CsvImagesOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check image field exists
      const imgValue = record[imageField];
      if (!imgValue || typeof imgValue !== 'string') {
        errors.push({
          index: i,
          field: imageField,
          message: `Required field "${imageField}" must be a non-empty string`,
          value: imgValue,
        });
        recordValid = false;
      }

      if (recordValid) validCount++;
    }

    return {
      valid: errors.length === 0,
      errors,
      stats: {
        total: input.length,
        valid: validCount,
        invalid: input.length - validCount,
      },
    };
  }

  /**
   * Format data to CSV+Images format
   */
  async format(input: unknown[], options: CsvImagesOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const basePath = options.basePath;
    const includeFields = options.includeFields;
    const excludeFields = new Set(options.excludeFields || []);

    const outputRecords: Record<string, unknown>[] = [];
    const outputFiles: string[] = [];
    let skipped = 0;

    // Create images dir if copying
    const imagesDir = path.join(outputDir, 'images');
    if (options.copyMedia) {
      await ensureDir(imagesDir);
    }

    // Track filename collisions
    const filenameCounts = new Map<string, number>();

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const imgPath = String(record[imageField] || '');

      if (!imgPath) {
        skipped++;
        continue;
      }

      // Build output record with field filtering
      const outputRecord: Record<string, unknown> = {};
      const keys = includeFields || Object.keys(record);

      for (const key of keys) {
        if (excludeFields.has(key)) continue;

        if (key === imageField && options.copyMedia) {
          // Will update image path below
          continue;
        }

        outputRecord[key] = record[key];
      }

      // Handle image copying
      if (options.copyMedia) {
        const srcPath = resolveImagePath(imgPath, basePath);

        // Handle filename collisions
        let destName = path.basename(imgPath);
        const count = filenameCounts.get(destName) || 0;
        if (count > 0) {
          const ext = path.extname(destName);
          const nameWithoutExt = path.basename(destName, ext);
          destName = `${nameWithoutExt}_${count}${ext}`;
        }
        filenameCounts.set(path.basename(imgPath), count + 1);

        const destPath = path.join(imagesDir, destName);
        try {
          await copyImage(srcPath, destPath);
          outputRecord.image_path = `images/${destName}`;
        } catch {
          outputRecord.image_path = imgPath;
        }
      } else {
        outputRecord.image_path = imgPath;
      }

      outputRecords.push(outputRecord);
    }

    // Write data.csv
    const csvPath = path.join(outputDir, 'data.csv');
    await writeData(csvPath, outputRecords);
    outputFiles.push(csvPath);

    // Write data.json
    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, outputRecords, true);
    outputFiles.push(jsonPath);

    // Write data.jsonl
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = outputRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    return {
      outputDir,
      files: {
        all: outputFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'csv-images-dataset',
        timestamp: Date.now(),
        counts: {
          train: outputRecords.length,
          validation: 0,
          test: 0,
          total: outputRecords.length,
        },
      },
    };
  }
}

/**
 * CSV+Images formatter instance
 */
export const csvImagesFormatter = new CsvImagesFormatter();

/**
 * Convenience function to format data
 */
export async function formatToCsvImages(
  data: unknown[],
  outputDir: string,
  options?: Partial<CsvImagesOptions>
): Promise<FormattedOutput> {
  const formatter = new CsvImagesFormatter();
  const fullOptions: CsvImagesOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'csv-images',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
