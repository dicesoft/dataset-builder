/**
 * Shared vision utilities for vision dataset formatters
 * Image validation, path resolution, bbox conversion
 */

import fs from 'fs/promises';
import path from 'path';
import { copyFile as baseCopyFile, fileExists } from '../utils';

/**
 * Default allowed image extensions
 */
export const DEFAULT_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.tiff',
  '.tif',
  '.svg',
];

/**
 * Resolve an image path relative to a base directory
 * Returns absolute path
 */
export function resolveImagePath(imagePath: string, basePath?: string): string {
  if (path.isAbsolute(imagePath)) return imagePath;
  return path.resolve(basePath || process.cwd(), imagePath);
}

/**
 * Validate an image file exists and has an allowed extension
 * No sharp dependency — extension-based + fs.access only
 */
export async function validateImage(
  imagePath: string,
  allowedExts: string[] = DEFAULT_IMAGE_EXTENSIONS
): Promise<{ valid: boolean; error?: string }> {
  const ext = path.extname(imagePath).toLowerCase();
  if (!allowedExts.includes(ext)) {
    return { valid: false, error: `Unsupported image extension: ${ext}` };
  }

  const exists = await fileExists(imagePath);
  if (!exists) {
    return { valid: false, error: `Image file not found: ${imagePath}` };
  }

  return { valid: true };
}

/**
 * Copy an image file to a destination
 * Thin wrapper over base copyFile
 */
export async function copyImage(src: string, dest: string): Promise<void> {
  await baseCopyFile(src, dest);
}

/**
 * Read an image file as base64 string
 * Returns null if file exceeds maxSizeBytes
 */
export async function imageToBase64(
  imagePath: string,
  maxSizeBytes?: number
): Promise<string | null> {
  try {
    const stat = await fs.stat(imagePath);
    if (maxSizeBytes && stat.size > maxSizeBytes) {
      return null;
    }
    const content = await fs.readFile(imagePath);
    return content.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Convert COCO bbox [x, y, w, h] (absolute) to YOLO [cx, cy, w, h] (normalized)
 * @param bbox - COCO format [x_min, y_min, width, height] in pixels
 * @param imgW - Image width in pixels
 * @param imgH - Image height in pixels
 * @returns YOLO format [center_x, center_y, width, height] normalized 0-1
 */
export function convertBboxCocoToYolo(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number
): [number, number, number, number] {
  const [x, y, w, h] = bbox;
  const cx = (x + w / 2) / imgW;
  const cy = (y + h / 2) / imgH;
  const nw = w / imgW;
  const nh = h / imgH;
  return [cx, cy, nw, nh];
}

/**
 * Convert YOLO bbox [cx, cy, w, h] (normalized) to COCO [x, y, w, h] (absolute)
 * @param bbox - YOLO format [center_x, center_y, width, height] normalized 0-1
 * @param imgW - Image width in pixels
 * @param imgH - Image height in pixels
 * @returns COCO format [x_min, y_min, width, height] in pixels
 */
export function convertBboxYoloToCoco(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number
): [number, number, number, number] {
  const [cx, cy, nw, nh] = bbox;
  const w = nw * imgW;
  const h = nh * imgH;
  const x = cx * imgW - w / 2;
  const y = cy * imgH - h / 2;
  return [x, y, w, h];
}

/**
 * Get a portable relative image path from outputDir
 * Always uses forward slashes for cross-platform compatibility
 */
export function getRelativeImagePath(imagePath: string, outputDir: string): string {
  const rel = path.relative(outputDir, imagePath);
  return rel.replace(/\\/g, '/');
}

/**
 * Batch validate images in a dataset
 * Returns indices of invalid records and error messages
 */
export async function batchValidateImages(
  data: unknown[],
  imageField: string,
  basePath?: string,
  allowedExts: string[] = DEFAULT_IMAGE_EXTENSIONS
): Promise<{ validIndices: number[]; errors: Array<{ index: number; error: string }> }> {
  const validIndices: number[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    const imgPath = record[imageField] as string | undefined;

    if (!imgPath) {
      errors.push({ index: i, error: `Missing image field "${imageField}"` });
      continue;
    }

    const fullPath = resolveImagePath(String(imgPath), basePath);
    const result = await validateImage(fullPath, allowedExts);

    if (result.valid) {
      validIndices.push(i);
    } else {
      errors.push({ index: i, error: result.error || 'Unknown validation error' });
    }
  }

  return { validIndices, errors };
}
