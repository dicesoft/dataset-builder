/**
 * COCO-Seg formatter
 * COCO annotation format with segmentation mask references
 * Output: annotations.json (with mask_file references), masks/, data.json, data.jsonl
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput } from '../types';
import type { COCOSegOptions } from '../types';
import { ensureDir, writeData, getFieldValue } from '../utils';
import { resolveImagePath, copyImage } from './utils';

/**
 * COCO-Seg annotation (extends COCO with mask reference)
 */
export interface COCOSegAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: [number, number, number, number];
  area: number;
  iscrowd: number;
  segmentation: { mask_file: string };
}

/**
 * COCO-Seg formatter implementation
 */
export class COCOSegFormatter implements Formatter<COCOSegOptions> {
  name = 'coco-seg';
  description = 'COCO segmentation format with mask file references';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  validate(input: unknown[], options?: Partial<COCOSegOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';
    const maskField = options?.maskField || 'mask_path';
    const categoryNameField = options?.categoryNameField || 'category';

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

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

      const maskValue = getFieldValue(record, maskField);
      if (!maskValue || typeof maskValue !== 'string') {
        errors.push({
          index: i,
          field: maskField,
          message: `Required field "${maskField}" must be a non-empty string`,
          value: maskValue,
        });
        recordValid = false;
      }

      const catValue = getFieldValue(record, categoryNameField);
      if (catValue === undefined || catValue === null || catValue === '') {
        errors.push({
          index: i,
          field: categoryNameField,
          message: `Required field "${categoryNameField}" must be present`,
          value: catValue,
        });
        recordValid = false;
      }

      if (recordValid) validCount++;
    }

    return {
      valid: errors.length === 0,
      errors,
      stats: { total: input.length, valid: validCount, invalid: input.length - validCount },
    };
  }

  async format(input: unknown[], options: COCOSegOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const maskField = options.maskField || 'mask_path';
    const bboxField = options.bboxField || 'bbox';
    const categoryNameField = options.categoryNameField || 'category';
    const basePath = options.basePath;

    // Build category mapping
    const categoryMap = new Map<string, number>();
    let nextCatId = 1;

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const catName = String(getFieldValue(record, categoryNameField) || '');
      if (catName && !categoryMap.has(catName)) {
        categoryMap.set(catName, nextCatId++);
      }
    }

    // Build COCO structure
    const images: Array<{ id: number; file_name: string; width: number; height: number }> = [];
    const annotations: COCOSegAnnotation[] = [];
    const categories: Array<{ id: number; name: string; supercategory: string }> = [];
    const outputFiles: string[] = [];

    for (const [name, id] of categoryMap) {
      categories.push({ id, name, supercategory: name });
    }

    // Create masks output dir
    const masksOutputDir = path.join(outputDir, 'masks');
    if (options.copyMedia) {
      await ensureDir(masksOutputDir);
    }

    // Create images dir if copying
    const imagesDir = path.join(outputDir, 'images');
    if (options.copyMedia) {
      await ensureDir(imagesDir);
    }

    const imageIdMap = new Map<string, number>();
    let nextImageId = 1;
    let annotationId = 1;
    let skipped = 0;

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const imgPath = String(getFieldValue(record, imageField) || '');
      const maskPath = String(getFieldValue(record, maskField) || '');

      if (!imgPath || !maskPath) {
        skipped++;
        continue;
      }

      // Get or create image entry
      let imageId: number;
      if (imageIdMap.has(imgPath)) {
        imageId = imageIdMap.get(imgPath)!;
      } else {
        imageId = nextImageId++;
        imageIdMap.set(imgPath, imageId);

        const width = Number(record.width || record.image_width || 0);
        const height = Number(record.height || record.image_height || 0);

        let fileName = path.basename(imgPath);

        if (options.copyMedia) {
          const srcPath = resolveImagePath(imgPath, basePath);
          try {
            await copyImage(srcPath, path.join(imagesDir, fileName));
            fileName = `images/${fileName}`;
          } catch {
            // Keep original path
          }
        }

        images.push({ id: imageId, file_name: fileName, width, height });
      }

      // Copy mask if requested
      let maskFileName = path.basename(maskPath);
      if (options.copyMedia) {
        const srcMaskPath = path.isAbsolute(maskPath)
          ? maskPath
          : path.resolve(basePath || process.cwd(), maskPath);
        try {
          await copyImage(srcMaskPath, path.join(masksOutputDir, maskFileName));
          maskFileName = `masks/${maskFileName}`;
        } catch {
          // Keep original path
        }
      }

      // Parse bbox
      const bboxValue = getFieldValue(record, bboxField);
      let bbox: [number, number, number, number] = [0, 0, 0, 0];
      if (Array.isArray(bboxValue)) {
        bbox = bboxValue.map(Number) as [number, number, number, number];
      } else if (typeof bboxValue === 'string') {
        try {
          bbox = JSON.parse(bboxValue);
        } catch {
          // Use default
        }
      }

      const area = Number(record.area || bbox[2] * bbox[3] || 0);
      const catName = String(getFieldValue(record, categoryNameField) || '');
      const catId = categoryMap.get(catName) || 0;

      annotations.push({
        id: annotationId++,
        image_id: imageId,
        category_id: catId,
        bbox,
        area,
        iscrowd: 0,
        segmentation: { mask_file: maskFileName },
      });
    }

    // Write annotations.json
    const cocoData = { images, annotations, categories };
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
        mask_file: ann.segmentation.mask_file,
      };
    });

    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, flatRecords, true);
    outputFiles.push(jsonPath);

    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = flatRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    return {
      outputDir,
      files: { all: outputFiles },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'coco-seg-dataset',
        timestamp: Date.now(),
        counts: {
          train: annotations.length,
          validation: 0,
          test: 0,
          total: annotations.length,
        },
        stats: {
          fieldStats: {
            images: { type: 'number', nonNull: images.length, nullCount: 0 },
            masks: { type: 'number', nonNull: annotations.length, nullCount: 0 },
            categories: { type: 'number', nonNull: categories.length, nullCount: 0 },
          },
        },
      },
    };
  }
}

export const cocoSegFormatter = new COCOSegFormatter();
