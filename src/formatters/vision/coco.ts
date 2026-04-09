/**
 * COCO formatter
 * Microsoft Common Objects in Context annotation format
 * Output: annotations.json (standard COCO structure) + data.json + data.jsonl
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, COCOOptions } from '../types';
import { ensureDir, writeData, getFieldValue } from '../utils';
import { resolveImagePath, copyImage } from './utils';

/**
 * COCO annotation structure
 */
export interface COCOAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number];
  area: number;
  iscrowd: number;
}

/**
 * COCO image entry
 */
export interface COCOImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
}

/**
 * COCO category
 */
export interface COCOCategory {
  id: number;
  name: string;
  supercategory: string;
}

/**
 * Full COCO annotations structure
 */
export interface COCOAnnotations {
  images: COCOImage[];
  annotations: COCOAnnotation[];
  categories: COCOCategory[];
}

/**
 * COCO formatter implementation
 */
export class COCOFormatter implements Formatter<COCOOptions> {
  name = 'coco';
  description = 'COCO object detection annotation format';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for COCO format
   * Requires image field and bbox data
   */
  validate(input: unknown[], options?: Partial<COCOOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';
    const bboxField = options?.bboxField || 'bbox';
    const categoryNameField = options?.categoryNameField || 'category';

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check image field
      const imgValue = getFieldValue(record, imageField);
      if (!imgValue || typeof imgValue !== 'string') {
        errors.push({
          index: i,
          field: imageField,
          message: `Required field "${imageField}" must be a non-empty string`,
          value: imgValue,
        });
        recordValid = false;
      }

      // Check bbox field
      const bboxValue = getFieldValue(record, bboxField);
      let bbox: number[] | null = null;

      if (typeof bboxValue === 'string') {
        try {
          bbox = JSON.parse(bboxValue);
        } catch {
          // Not valid JSON
        }
      } else if (Array.isArray(bboxValue)) {
        bbox = bboxValue as number[];
      }

      if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
        errors.push({
          index: i,
          field: bboxField,
          message: `Field "${bboxField}" must be an array of 4 numbers [x, y, w, h]`,
          value: bboxValue,
        });
        recordValid = false;
      }

      // Check category
      const catValue = getFieldValue(record, categoryNameField);
      const catIdValue = options?.categoryIdField
        ? getFieldValue(record, options.categoryIdField)
        : undefined;
      if (
        (catValue === undefined || catValue === null || catValue === '') &&
        (catIdValue === undefined || catIdValue === null)
      ) {
        errors.push({
          index: i,
          field: categoryNameField,
          message: `Either "${categoryNameField}" or category ID field must be present`,
          value: catValue,
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
   * Format data to COCO format
   */
  async format(input: unknown[], options: COCOOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const bboxField = options.bboxField || 'bbox';
    const categoryIdField = options.categoryIdField || 'category_id';
    const categoryNameField = options.categoryNameField || 'category';
    const basePath = options.basePath;

    // Build category mapping from data
    const categoryMap = new Map<string, number>();
    let nextCatId = 1;

    // First pass: collect categories
    for (const item of input) {
      const record = item as Record<string, unknown>;
      const catName = String(getFieldValue(record, categoryNameField) || '');
      if (catName && !categoryMap.has(catName)) {
        const explicitId = getFieldValue(record, categoryIdField);
        if (explicitId !== undefined && explicitId !== null && typeof explicitId === 'number') {
          categoryMap.set(catName, explicitId);
          if (explicitId >= nextCatId) nextCatId = explicitId + 1;
        } else {
          categoryMap.set(catName, nextCatId++);
        }
      }
    }

    // Build COCO structure
    const images: COCOImage[] = [];
    const annotations: COCOAnnotation[] = [];
    const categories: COCOCategory[] = [];
    const outputFiles: string[] = [];

    // Build categories array
    for (const [name, id] of categoryMap) {
      categories.push({
        id,
        name,
        supercategory: name,
      });
    }

    // Deduplicate images: track unique images by file path
    const imageIdMap = new Map<string, number>();
    let nextImageId = 1;
    let annotationId = 1;
    let skipped = 0;

    // Create images dir if copying
    const imagesDir = path.join(outputDir, 'images');
    if (options.copyMedia) {
      await ensureDir(imagesDir);
    }

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const imgPath = String(getFieldValue(record, imageField) || '');

      if (!imgPath) {
        skipped++;
        continue;
      }

      // Parse bbox
      const bboxValue = getFieldValue(record, bboxField);
      let bbox: number[];

      if (typeof bboxValue === 'string') {
        try {
          bbox = JSON.parse(bboxValue);
        } catch {
          skipped++;
          continue;
        }
      } else if (Array.isArray(bboxValue)) {
        bbox = bboxValue.map(Number);
      } else {
        skipped++;
        continue;
      }

      if (bbox.length !== 4) {
        skipped++;
        continue;
      }

      // Get or create image entry (deduplicate)
      let imageId: number;
      if (imageIdMap.has(imgPath)) {
        imageId = imageIdMap.get(imgPath)!;
      } else {
        imageId = nextImageId++;
        imageIdMap.set(imgPath, imageId);

        // Get image dimensions from record or defaults
        const width = Number(record.width || record.image_width || 0);
        const height = Number(record.height || record.image_height || 0);

        let fileName = path.basename(imgPath);

        // Copy image if requested
        if (options.copyMedia) {
          const srcPath = resolveImagePath(imgPath, basePath);
          const destPath = path.join(imagesDir, fileName);
          try {
            await copyImage(srcPath, destPath);
            fileName = `images/${fileName}`;
          } catch {
            // Keep original path
          }
        }

        images.push({
          id: imageId,
          file_name: fileName,
          width,
          height,
        });
      }

      // Get category
      const catName = String(getFieldValue(record, categoryNameField) || '');
      const catId = categoryMap.get(catName) || 0;

      // Compute area from bbox [x, y, w, h]
      const area = bbox[2] * bbox[3];

      annotations.push({
        id: annotationId++,
        image_id: imageId,
        category_id: catId,
        bbox: bbox as [number, number, number, number],
        area,
        iscrowd: 0,
      });
    }

    // Write annotations.json (COCO standard format)
    const cocoData: COCOAnnotations = {
      images,
      annotations,
      categories,
    };

    const annoPath = path.join(outputDir, 'annotations.json');
    await writeData(annoPath, cocoData, true);
    outputFiles.push(annoPath);

    // Write flat data files
    const flatRecords = annotations.map((ann) => {
      const img = images.find((i) => i.id === ann.image_id);
      const cat = categories.find((c) => c.id === ann.category_id);
      return {
        image_id: ann.image_id,
        file_name: img?.file_name || '',
        category_id: ann.category_id,
        category_name: cat?.name || '',
        bbox: ann.bbox,
        area: ann.area,
      };
    });

    // Write data.json
    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, flatRecords, true);
    outputFiles.push(jsonPath);

    // Write data.jsonl
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = flatRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    return {
      outputDir,
      files: {
        all: outputFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'coco-dataset',
        timestamp: Date.now(),
        counts: {
          train: annotations.length,
          validation: 0,
          test: 0,
          total: annotations.length,
        },
        stats: {
          fieldStats: {
            images: {
              type: 'number',
              nonNull: images.length,
              nullCount: 0,
            },
            categories: {
              type: 'number',
              nonNull: categories.length,
              nullCount: 0,
            },
          },
        },
      },
    };
  }
}

/**
 * COCO formatter instance
 */
export const cocoFormatter = new COCOFormatter();

/**
 * Convenience function to format data
 */
export async function formatToCOCO(
  data: unknown[],
  outputDir: string,
  options?: Partial<COCOOptions>
): Promise<FormattedOutput> {
  const formatter = new COCOFormatter();
  const fullOptions: COCOOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'coco',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
