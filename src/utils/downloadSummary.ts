/**
 * Pre-download summary and confirmation prompt with optional size estimation
 */

import chalk from 'chalk';
import type { DownloadItem } from '../downloader';
import { confirm } from './confirm';
import { isJsonMode } from './output';
import {
  isYouTubeUrl,
  isYouTubePlaylist,
  getVideoFileSize,
  getPlaylistInfo,
} from '../downloader/videoHandler';
import { formatBytes } from './tui';

export interface DownloadSummaryOptions {
  timeout?: number;
  cookiesFile?: string;
  skipEstimate?: boolean;
}

interface SizeEstimate {
  totalBytes: number;
  knownCount: number;
  unknownCount: number;
  byType: Record<string, { bytes: number; known: number; unknown: number }>;
}

/**
 * Estimate download sizes using HTTP HEAD requests and yt-dlp metadata.
 */
async function estimateDownloadSizes(
  items: DownloadItem[],
  timeout: number = 5000,
  cookiesFile?: string
): Promise<SizeEstimate> {
  const result: SizeEstimate = {
    totalBytes: 0,
    knownCount: 0,
    unknownCount: 0,
    byType: {},
  };

  const initType = (type: string) => {
    if (!result.byType[type]) {
      result.byType[type] = { bytes: 0, known: 0, unknown: 0 };
    }
  };

  const promises = items.map(async (item) => {
    const type = item.type || 'unknown';
    initType(type);

    try {
      if (isYouTubePlaylist(item.url)) {
        // For playlists: get entry count, sample 1 video for average size
        const info = await getPlaylistInfo(item.url, cookiesFile);
        if (info && info.entries.length > 0) {
          // Sample first video for size estimate
          const sampleEntry = info.entries[0];
          const sampleUrl = sampleEntry.url || `https://www.youtube.com/watch?v=${sampleEntry.id}`;
          const sampleSize = await getVideoFileSize(sampleUrl, cookiesFile);
          if (sampleSize) {
            const estimatedTotal = sampleSize * info.entries.length;
            result.totalBytes += estimatedTotal;
            result.byType[type].bytes += estimatedTotal;
            result.byType[type].known += 1;
            result.knownCount += 1;
            return;
          }
        }
        result.unknownCount += 1;
        result.byType[type].unknown += 1;
      } else if (isYouTubeUrl(item.url)) {
        const size = await getVideoFileSize(item.url, cookiesFile);
        if (size) {
          result.totalBytes += size;
          result.byType[type].bytes += size;
          result.byType[type].known += 1;
          result.knownCount += 1;
          return;
        }
        result.unknownCount += 1;
        result.byType[type].unknown += 1;
      } else {
        // Regular URL: HTTP HEAD request
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(item.url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
          });
          clearTimeout(timer);
          const contentLength = response.headers.get('content-length');
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (size > 0) {
              result.totalBytes += size;
              result.byType[type].bytes += size;
              result.byType[type].known += 1;
              result.knownCount += 1;
              return;
            }
          }
        } catch {
          clearTimeout(timer);
        }
        result.unknownCount += 1;
        result.byType[type].unknown += 1;
      }
    } catch {
      result.unknownCount += 1;
      result.byType[type].unknown += 1;
    }
  });

  await Promise.allSettled(promises);
  return result;
}

/**
 * Show a download summary and ask for user confirmation.
 * Returns true if user confirms, false if cancelled.
 */
export async function showDownloadSummary(
  items: DownloadItem[],
  totalVideoCount: number,
  skipConfirmation: boolean,
  options?: DownloadSummaryOptions
): Promise<boolean> {
  if (items.length === 0) return false;

  // In JSON mode, skip the interactive summary and auto-confirm
  if (isJsonMode()) {
    return true;
  }

  // Group items by type
  const byType: Record<string, DownloadItem[]> = {};
  for (const item of items) {
    const type = item.type || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(item);
  }

  // Estimate sizes unless skipped
  let sizeEstimate: SizeEstimate | null = null;
  if (!options?.skipEstimate) {
    console.log();
    console.log(chalk.gray('  Estimating download sizes...'));
    sizeEstimate = await estimateDownloadSizes(
      items,
      options?.timeout ?? 5000,
      options?.cookiesFile
    );
  }

  console.log();
  console.log(chalk.bold.cyan('Download Summary'));
  console.log(chalk.cyan('─'.repeat(50)));

  // Type breakdown with optional size info
  for (const [type, typeItems] of Object.entries(byType)) {
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    const countStr = `${typeItems.length} files`;
    if (sizeEstimate?.byType[type] && sizeEstimate.byType[type].bytes > 0) {
      const sizeStr = `~${formatBytes(sizeEstimate.byType[type].bytes)}`;
      console.log(
        `  ${chalk.bold(label.padEnd(12))} ${countStr.padEnd(12)} ${chalk.yellow(`(${sizeStr})`)}`
      );
    } else {
      console.log(`  ${chalk.bold(label.padEnd(12))} ${countStr}`);
    }
  }

  console.log(chalk.cyan('─'.repeat(50)));

  // Total counts
  if (totalVideoCount > items.length) {
    console.log(
      `  ${chalk.bold('Total:')} ${items.length} URLs (${totalVideoCount} videos including playlists)`
    );
  } else {
    console.log(`  ${chalk.bold('Total:')} ${items.length} files`);
  }

  // Show estimated total size
  if (sizeEstimate && sizeEstimate.totalBytes > 0) {
    console.log(
      `  ${chalk.bold('Estimated total:')} ${chalk.yellow(`~${formatBytes(sizeEstimate.totalBytes)}`)}`
    );
    if (sizeEstimate.unknownCount > 0) {
      console.log(
        chalk.gray(
          `  (${sizeEstimate.knownCount} of ${sizeEstimate.knownCount + sizeEstimate.unknownCount} files measured; ${sizeEstimate.unknownCount} unknown)`
        )
      );
    }
  }

  // Sample URLs (up to 5)
  console.log();
  console.log(chalk.gray('  Sample URLs:'));
  const sampleCount = Math.min(5, items.length);
  for (let i = 0; i < sampleCount; i++) {
    const url = items[i].url;
    const truncated = url.length > 70 ? url.slice(0, 67) + '...' : url;
    console.log(chalk.gray(`    ${truncated}`));
  }
  if (items.length > 5) {
    console.log(chalk.gray(`    ... and ${items.length - 5} more`));
  }

  console.log(chalk.cyan('─'.repeat(50)));

  if (skipConfirmation) {
    console.log(chalk.gray('  Confirmation skipped (-y flag)'));
    return true;
  }

  const confirmed = await confirm('Proceed with download?', true);
  if (!confirmed) {
    console.log(chalk.yellow('Download cancelled.'));
    return false;
  }
  return true;
}
