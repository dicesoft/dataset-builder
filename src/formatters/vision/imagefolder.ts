/**
 * ImageFolder formatter
 * HuggingFace ImageFolder format: class_a/img1.jpg + metadata.csv
 * Used for image classification datasets
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, ImageFolderOptions } from '../types';
import { ensureDir, writeData } from '../utils';
import { resolveImagePath, validateImage, copyImage, DEFAULT_IMAGE_EXTENSIONS } from './utils';

/**
 * ImageFolder metadata record
 */
export interface ImageFolderMetadataRecord {
  file_name: string;
  label: string;
  [key: string]: unknown;
}

/**
 * ImageFolder formatter implementation
 */
export class ImageFolderFormatter implements Formatter<ImageFolderOptions> {
  name = 'imagefolder';
  description = 'HuggingFace ImageFolder format for image classification';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for ImageFolder format
   * Requires classField and imageField
   */
  validate(input: unknown[], options?: Partial<ImageFolderOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';
    const classField = options?.classField;

    if (!classField) {
      return {
        valid: false,
        errors: [
          {
            index: -1,
            message: 'ImageFolder format requires --class-field option',
          },
        ],
        stats: { total: input.length, valid: 0, invalid: input.length },
      };
    }

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check image field
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

      // Check class field
      const classValue = record[classField];
      if (classValue === undefined || classValue === null || classValue === '') {
        errors.push({
          index: i,
          field: classField,
          message: `Required field "${classField}" is missing or empty`,
          value: classValue,
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
   * Format data to ImageFolder format
   * Creates class_name/ directories with images + metadata.csv
   */
  async format(input: unknown[], options: ImageFolderOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const classField = options.classField;
    const allowedExts = options.imageExtensions || DEFAULT_IMAGE_EXTENSIONS;
    const basePath = options.basePath;

    const metadataRecords: ImageFolderMetadataRecord[] = [];
    const outputFiles: string[] = [];
    let skipped = 0;

    // Track filename collisions per class
    const filenameCounts = new Map<string, number>();

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const imgPath = String(record[imageField] || '');
      const classLabel = String(record[classField] || '');

      if (!imgPath || !classLabel) {
        skipped++;
        continue;
      }

      // Sanitize class label for folder name
      const sanitizedClass = classLabel
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .trim();

      if (!sanitizedClass) {
        skipped++;
        continue;
      }

      // Resolve source image
      const srcPath = resolveImagePath(imgPath, basePath);

      // Validate image extension
      const ext = path.extname(imgPath).toLowerCase();
      if (!allowedExts.includes(ext)) {
        skipped++;
        continue;
      }

      // Handle filename collisions
      let destName = path.basename(imgPath);
      const collisionKey = `${sanitizedClass}/${destName}`;
      const count = filenameCounts.get(collisionKey) || 0;
      if (count > 0) {
        const nameWithoutExt = path.basename(destName, ext);
        destName = `${nameWithoutExt}_${count}${ext}`;
      }
      filenameCounts.set(collisionKey, count + 1);

      // Create class directory and copy image
      const classDir = path.join(outputDir, sanitizedClass);
      await ensureDir(classDir);

      const destPath = path.join(classDir, destName);
      try {
        await copyImage(srcPath, destPath);
      } catch {
        skipped++;
        continue;
      }

      const relativePath = `${sanitizedClass}/${destName}`;

      // Build metadata record with all extra fields
      const metaRecord: ImageFolderMetadataRecord = {
        file_name: relativePath,
        label: classLabel,
      };

      // Include extra fields from the record
      for (const [key, value] of Object.entries(record)) {
        if (key !== imageField && key !== classField) {
          metaRecord[key] = value;
        }
      }

      metadataRecords.push(metaRecord);
    }

    // Write metadata.csv
    if (metadataRecords.length > 0) {
      const csvPath = path.join(outputDir, 'metadata.csv');
      await writeData(csvPath, metadataRecords);
      outputFiles.push(csvPath);
    }

    // Write data.json
    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, metadataRecords, true);
    outputFiles.push(jsonPath);

    // Write data.jsonl
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = metadataRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    // Collect unique classes
    const classes = [...new Set(metadataRecords.map((r) => r.label))];

    return {
      outputDir,
      files: {
        all: outputFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'imagefolder-dataset',
        timestamp: Date.now(),
        counts: {
          train: metadataRecords.length,
          validation: 0,
          test: 0,
          total: metadataRecords.length,
        },
        stats: {
          fieldStats: {
            classes: {
              type: 'string',
              nonNull: classes.length,
              nullCount: 0,
            },
          },
        },
      },
    };
  }
}

/**
 * ImageFolder formatter instance
 */
export const imagefolderFormatter = new ImageFolderFormatter();

/**
 * Convenience function to format data
 */
export async function formatToImageFolder(
  data: unknown[],
  outputDir: string,
  options: Partial<ImageFolderOptions> & { classField: string }
): Promise<FormattedOutput> {
  const formatter = new ImageFolderFormatter();
  const fullOptions: ImageFolderOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'imagefolder',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
