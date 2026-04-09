/**
 * Image deduplication using content hashing
 * Detects duplicate images even with different filenames or URLs
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface ImageHashResult {
  file: string;
  hash: string;
  isDuplicate: boolean;
  duplicatesOf?: string[];
}

/**
 * Compute hash of an image file
 * Uses SHA-256 of file content for exact duplicate detection
 * For perceptual hashing, this could use blockhash or image-hash library
 */
export async function computeImageHash(filePath: string): Promise<string> {
  try {
    const buffer = fs.readFileSync(filePath);
    return createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    throw new Error(`Failed to hash ${filePath}: ${error}`);
  }
}

/**
 * Get all image files in a directory
 */
export function getImageFiles(dirPath: string): string[] {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'];
  const files: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (imageExtensions.includes(ext)) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  }

  return files;
}

/**
 * Find duplicate images in a directory
 * @param dirPath - Directory to scan
 * @param options - Options for duplicate detection
 * @returns Array of results with duplicate status
 */
export async function findDuplicateImages(
  dirPath: string,
  options?: {
    dryRun?: boolean;
  }
): Promise<ImageHashResult[]> {
  const files = getImageFiles(dirPath);
  const hashes = new Map<string, string[]>(); // hash -> file paths
  const results: ImageHashResult[] = [];

  for (const file of files) {
    try {
      const hash = await computeImageHash(file);

      if (hashes.has(hash)) {
        const existing = hashes.get(hash)!;
        results.push({
          file,
          hash,
          isDuplicate: true,
          duplicatesOf: [...existing],
        });
        existing.push(file);
      } else {
        hashes.set(hash, [file]);
        results.push({
          file,
          hash,
          isDuplicate: false,
        });
      }
    } catch (error) {
      // Skip files that can't be hashed
      results.push({
        file,
        hash: '',
        isDuplicate: false,
      });
    }
  }

  return results;
}

/**
 * Remove duplicate images from a directory
 * @param dirPath - Directory to clean
 * @param options - Options for removal
 * @returns Object with removed and kept file paths
 */
export async function removeDuplicateImages(
  dirPath: string,
  options?: {
    keepFirst?: boolean; // Keep first occurrence, remove rest (default: true)
    dryRun?: boolean;
  }
): Promise<{ removed: string[]; kept: string[] }> {
  const duplicates = await findDuplicateImages(dirPath, options);
  const removed: string[] = [];
  const kept: string[] = [];

  for (const result of duplicates) {
    if (result.isDuplicate) {
      if (!options?.dryRun) {
        try {
          fs.unlinkSync(result.file);
        } catch (error) {
          console.error(`Failed to remove ${result.file}: ${error}`);
        }
      }
      removed.push(result.file);
    } else {
      kept.push(result.file);
    }
  }

  return { removed, kept };
}

/**
 * Group duplicate images by hash
 * @param results - Results from findDuplicateImages
 * @returns Map of hash to array of duplicate files
 */
export function groupDuplicatesByHash(results: ImageHashResult[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const result of results) {
    if (!result.hash) continue;

    const existing = groups.get(result.hash) || [];
    existing.push(result.file);
    groups.set(result.hash, existing);
  }

  // Only return groups with duplicates
  const duplicates = new Map<string, string[]>();
  for (const [hash, files] of groups) {
    if (files.length > 1) {
      duplicates.set(hash, files);
    }
  }

  return duplicates;
}
