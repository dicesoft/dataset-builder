/**
 * YOLO formatter
 * Ultralytics YOLO object detection format
 * Output: images/, labels/, classes.txt, data.yaml
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, YOLOOptions } from '../types';
import { ensureDir, writeData, getFieldValue } from '../utils';
import { resolveImagePath, copyImage, convertBboxCocoToYolo } from './utils';

/**
 * YOLO formatter implementation
 */
export class YOLOFormatter implements Formatter<YOLOOptions> {
  name = 'yolo';
  description = 'Ultralytics YOLO object detection format';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for YOLO format
   * Requires image, bbox, and class fields
   */
  validate(input: unknown[], options?: Partial<YOLOOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';
    const bboxField = options?.bboxField || 'bbox';
    const classField = options?.classField;

    if (!classField) {
      return {
        valid: false,
        errors: [
          {
            index: -1,
            message: 'YOLO format requires --class-field option',
          },
        ],
        stats: { total: input.length, valid: 0, invalid: input.length },
      };
    }

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
          message: `Field "${bboxField}" must be an array of 4 numbers`,
          value: bboxValue,
        });
        recordValid = false;
      }

      // Check class field
      const classValue = getFieldValue(record, classField);
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
   * Format data to YOLO format
   */
  async format(input: unknown[], options: YOLOOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const bboxField = options.bboxField || 'bbox';
    const classField = options.classField;
    const basePath = options.basePath;
    const defaultWidth = options.imageWidth || 0;
    const defaultHeight = options.imageHeight || 0;

    // Create output directories
    const imagesDir = path.join(outputDir, 'images');
    const labelsDir = path.join(outputDir, 'labels');
    await ensureDir(imagesDir);
    await ensureDir(labelsDir);

    // Build class mapping from data
    const classNames = new Set<string>();
    for (const item of input) {
      const record = item as Record<string, unknown>;
      const classValue = String(getFieldValue(record, classField) || '');
      if (classValue) classNames.add(classValue);
    }
    const classNamesList = [...classNames].sort();
    const classIndexMap = new Map<string, number>();
    classNamesList.forEach((name, index) => {
      classIndexMap.set(name, index);
    });

    // Group annotations by image (multiple annotations per image)
    const imageAnnotations = new Map<
      string,
      Array<{ classIdx: number; bbox: [number, number, number, number] }>
    >();

    let skipped = 0;
    const outputFiles: string[] = [];

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

      // Get class index
      const className = String(getFieldValue(record, classField) || '');
      const classIdx = classIndexMap.get(className);
      if (classIdx === undefined) {
        skipped++;
        continue;
      }

      // Auto-detect bbox format: values > 1 means COCO (absolute), else YOLO (normalized)
      let yoloBbox: [number, number, number, number];
      const maxVal = Math.max(...bbox);

      if (maxVal > 1) {
        // COCO format: convert to YOLO
        const imgW = Number(record.width || record.image_width || defaultWidth) || 1;
        const imgH = Number(record.height || record.image_height || defaultHeight) || 1;
        yoloBbox = convertBboxCocoToYolo(bbox as [number, number, number, number], imgW, imgH);
      } else {
        // Already YOLO format
        yoloBbox = bbox as [number, number, number, number];
      }

      // Group by image path
      if (!imageAnnotations.has(imgPath)) {
        imageAnnotations.set(imgPath, []);
      }
      imageAnnotations.get(imgPath)!.push({ classIdx, bbox: yoloBbox });
    }

    // Write files for each image
    let totalAnnotations = 0;

    for (const [imgPath, annotations] of imageAnnotations) {
      const srcPath = resolveImagePath(imgPath, basePath);
      const imgBaseName = path.basename(imgPath);
      const labelName = path.basename(imgPath, path.extname(imgPath)) + '.txt';

      // Copy image
      const destImgPath = path.join(imagesDir, imgBaseName);
      try {
        await copyImage(srcPath, destImgPath);
      } catch {
        skipped++;
        continue;
      }

      // Write label file (one line per annotation)
      const labelLines = annotations.map((ann) => {
        const [cx, cy, w, h] = ann.bbox;
        return `${ann.classIdx} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
      });

      const labelPath = path.join(labelsDir, labelName);
      await fs.writeFile(labelPath, labelLines.join('\n'), 'utf-8');

      totalAnnotations += annotations.length;
    }

    // Write classes.txt
    const classesPath = path.join(outputDir, 'classes.txt');
    await fs.writeFile(classesPath, classNamesList.join('\n'), 'utf-8');
    outputFiles.push(classesPath);

    // Write data.yaml
    const yamlContent = [
      `# YOLO dataset configuration`,
      `# Generated by dataset-builder`,
      ``,
      `train: ./images`,
      `val: ./images`,
      ``,
      `nc: ${classNamesList.length}`,
      `names: [${classNamesList.map((n) => `'${n}'`).join(', ')}]`,
    ].join('\n');

    const yamlPath = path.join(outputDir, 'data.yaml');
    await fs.writeFile(yamlPath, yamlContent, 'utf-8');
    outputFiles.push(yamlPath);

    // Write flat data files
    const flatRecords: Record<string, unknown>[] = [];
    for (const [imgPath, annotations] of imageAnnotations) {
      for (const ann of annotations) {
        flatRecords.push({
          image: path.basename(imgPath),
          class_index: ann.classIdx,
          class_name: classNamesList[ann.classIdx],
          bbox: ann.bbox,
        });
      }
    }

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
        datasetName: options.datasetName || 'yolo-dataset',
        timestamp: Date.now(),
        counts: {
          train: totalAnnotations,
          validation: 0,
          test: 0,
          total: totalAnnotations,
        },
        stats: {
          fieldStats: {
            images: {
              type: 'number',
              nonNull: imageAnnotations.size,
              nullCount: 0,
            },
            classes: {
              type: 'number',
              nonNull: classNamesList.length,
              nullCount: 0,
            },
          },
        },
      },
    };
  }
}

/**
 * YOLO formatter instance
 */
export const yoloFormatter = new YOLOFormatter();

/**
 * Convenience function to format data
 */
export async function formatToYOLO(
  data: unknown[],
  outputDir: string,
  options: Partial<YOLOOptions> & { classField: string }
): Promise<FormattedOutput> {
  const formatter = new YOLOFormatter();
  const fullOptions: YOLOOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'yolo',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
