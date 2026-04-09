/**
 * YOLO-Seg formatter
 * YOLO segmentation format with polygon coordinates in label TXT files
 * Label format: class_id x1 y1 x2 y2 ... xn yn (normalized 0-1)
 * Output: images/, labels/ (TXT), classes.txt, data.yaml
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput } from '../types';
import type { YOLOSegOptions } from '../types';
import { ensureDir, writeData, getFieldValue } from '../utils';
import { resolveImagePath, copyImage } from './utils';
import { runPythonScript } from '../../transformer/python-runner';

/**
 * Extract polygon points from a mask PNG using Python helper
 */
async function maskToPolygon(
  maskPath: string,
  imageWidth: number,
  imageHeight: number
): Promise<Array<[number, number]>> {
  const scriptPath = path.resolve(__dirname, '../../../scripts/mask_to_polygon.py');
  const result = await runPythonScript(scriptPath, [
    '--mask',
    maskPath,
    '--image-width',
    String(imageWidth),
    '--image-height',
    String(imageHeight),
  ]);

  if (!result.success || !result.jsonOutput) {
    return [];
  }

  const json = result.jsonOutput as Record<string, unknown>;
  if (json.error || !Array.isArray(json.points)) {
    return [];
  }

  return json.points as Array<[number, number]>;
}

/**
 * YOLO-Seg formatter implementation
 */
export class YOLOSegFormatter implements Formatter<YOLOSegOptions> {
  name = 'yolo-seg';
  description = 'YOLO segmentation format with polygon labels';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  validate(input: unknown[], options?: Partial<YOLOSegOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';
    const maskField = options?.maskField || 'mask_path';
    const classField = options?.classField;

    if (!classField) {
      return {
        valid: false,
        errors: [
          {
            index: -1,
            message: 'YOLO-Seg format requires --class-field option',
          },
        ],
        stats: { total: input.length, valid: 0, invalid: input.length },
      };
    }

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
      stats: { total: input.length, valid: validCount, invalid: input.length - validCount },
    };
  }

  async format(input: unknown[], options: YOLOSegOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const maskField = options.maskField || 'mask_path';
    const classField = options.classField;
    const basePath = options.basePath;

    // Create output directories
    const imagesDir = path.join(outputDir, 'images');
    const labelsDir = path.join(outputDir, 'labels');
    await ensureDir(imagesDir);
    await ensureDir(labelsDir);

    // Build class mapping
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

    // Group annotations by image
    const imageAnnotations = new Map<
      string,
      Array<{ classIdx: number; maskPath: string; imageWidth: number; imageHeight: number }>
    >();

    let skipped = 0;
    const outputFiles: string[] = [];

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const imgPath = String(getFieldValue(record, imageField) || '');
      const maskPath = String(getFieldValue(record, maskField) || '');

      if (!imgPath || !maskPath) {
        skipped++;
        continue;
      }

      const className = String(getFieldValue(record, classField) || '');
      const classIdx = classIndexMap.get(className);
      if (classIdx === undefined) {
        skipped++;
        continue;
      }

      const imageWidth = Number(record.image_width || record.width || 0);
      const imageHeight = Number(record.image_height || record.height || 0);

      if (!imageAnnotations.has(imgPath)) {
        imageAnnotations.set(imgPath, []);
      }
      imageAnnotations.get(imgPath)!.push({ classIdx, maskPath, imageWidth, imageHeight });
    }

    // Process each image
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

      // Generate polygon labels for each annotation
      const labelLines: string[] = [];

      for (const ann of annotations) {
        const resolvedMask = path.isAbsolute(ann.maskPath)
          ? ann.maskPath
          : path.resolve(basePath || process.cwd(), ann.maskPath);

        const imgW = ann.imageWidth || 1;
        const imgH = ann.imageHeight || 1;
        const polygon = await maskToPolygon(resolvedMask, imgW, imgH);

        if (polygon.length >= 3) {
          // Format: class_id x1 y1 x2 y2 ... xn yn
          const coordStr = polygon.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(' ');
          labelLines.push(`${ann.classIdx} ${coordStr}`);
          totalAnnotations++;
        }
      }

      if (labelLines.length > 0) {
        const labelPath = path.join(labelsDir, labelName);
        await fs.writeFile(labelPath, labelLines.join('\n'), 'utf-8');
      }
    }

    // Write classes.txt
    const classesPath = path.join(outputDir, 'classes.txt');
    await fs.writeFile(classesPath, classNamesList.join('\n'), 'utf-8');
    outputFiles.push(classesPath);

    // Write data.yaml
    const yamlContent = [
      `# YOLO Segmentation dataset configuration`,
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

    // Write data.json + data.jsonl
    const flatRecords: Record<string, unknown>[] = [];
    for (const [imgPath, annotations] of imageAnnotations) {
      for (const ann of annotations) {
        flatRecords.push({
          image: path.basename(imgPath),
          class_index: ann.classIdx,
          class_name: classNamesList[ann.classIdx],
          mask_path: ann.maskPath,
        });
      }
    }

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
        datasetName: options.datasetName || 'yolo-seg-dataset',
        timestamp: Date.now(),
        counts: {
          train: totalAnnotations,
          validation: 0,
          test: 0,
          total: totalAnnotations,
        },
        stats: {
          fieldStats: {
            images: { type: 'number', nonNull: imageAnnotations.size, nullCount: 0 },
            classes: { type: 'number', nonNull: classNamesList.length, nullCount: 0 },
          },
        },
      },
    };
  }
}

export const yoloSegFormatter = new YOLOSegFormatter();
