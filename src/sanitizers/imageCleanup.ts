/**
 * Image cleanup pre-filter for the clean command.
 * Removes junk images (SVGs, icons, tiny files) and filters by size/dimensions.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { JUNK_PATTERNS, JUNK_EXTENSIONS } from '../transformer/deterministic';
import { getImageDimensions } from '../transformer/image-utils';

export interface ImageCleanupOptions {
  removeJunk?: boolean;
  minSize?: number;
  minDimensions?: { width: number; height: number };
}

export interface ImageCleanupResult {
  kept: string[];
  removed: { file: string; reason: string }[];
}

/**
 * Scan files in a directory (including SVGs/ICOs) and filter based on cleanup criteria.
 * Returns lists of kept and removed files with reasons.
 */
export async function filterJunkImages(
  dirPath: string,
  options: ImageCleanupOptions
): Promise<ImageCleanupResult> {
  const allExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico', '.cur'];
  const files: string[] = [];

  if (fsSync.existsSync(dirPath)) {
    const entries = fsSync.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (allExtensions.includes(ext)) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    }
  }

  const kept: string[] = [];
  const removed: { file: string; reason: string }[] = [];

  for (const file of files) {
    const fileName = path.basename(file).toLowerCase();
    const ext = path.extname(fileName).toLowerCase();
    let dominated = false;

    // --remove-junk checks
    if (options.removeJunk) {
      // Check junk extensions
      if (JUNK_EXTENSIONS.includes(ext)) {
        removed.push({ file, reason: `junk extension (${ext})` });
        dominated = true;
        continue;
      }

      // Check junk filename patterns
      for (const pattern of JUNK_PATTERNS) {
        // Reset lastIndex for stateful regexes
        pattern.lastIndex = 0;
        if (pattern.test(fileName)) {
          removed.push({ file, reason: `junk pattern (${pattern.source})` });
          dominated = true;
          break;
        }
      }
      if (dominated) continue;

      // Default 5KB threshold for --remove-junk (only if --min-size not specified)
      if (options.minSize === undefined) {
        try {
          const stat = await fs.stat(file);
          if (stat.size < 5000) {
            removed.push({ file, reason: `too small (${stat.size} < 5000 bytes)` });
            continue;
          }
        } catch {
          // Can't stat, skip this check
        }
      }
    }

    // --min-size check
    if (options.minSize !== undefined) {
      try {
        const stat = await fs.stat(file);
        if (stat.size < options.minSize) {
          removed.push({
            file,
            reason: `below min size (${stat.size} < ${options.minSize} bytes)`,
          });
          continue;
        }
      } catch {
        // Can't stat, skip this check
      }
    }

    // --min-dimensions check
    if (options.minDimensions) {
      try {
        const dims = await getImageDimensions(file);
        if (
          dims.width < options.minDimensions.width ||
          dims.height < options.minDimensions.height
        ) {
          removed.push({
            file,
            reason: `below min dimensions (${dims.width}x${dims.height} < ${options.minDimensions.width}x${options.minDimensions.height})`,
          });
          continue;
        }
      } catch {
        // Can't read dimensions (SVG, unsupported format) — skip this check
        // Those would already be caught by --remove-junk if enabled
      }
    }

    kept.push(file);
  }

  return { kept, removed };
}
