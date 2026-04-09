/**
 * TUI Progress Display for file downloads
 */

import chalk from 'chalk';
import type { DownloadProgress } from './index';
import { isJsonMode } from '../utils/output';

let currentProgress: DownloadProgress[] = [];
let totalItems = 0;
let lastUpdate = 0;
let verboseMode = false;
let isAlternateScreen = false;
let abortingFlag = false;

/** Create TUI for download progress */
export function createTUI(total: number, verbose: boolean = false): void {
  totalItems = total;
  currentProgress = [];
  lastUpdate = Date.now();
  verboseMode = verbose;

  if (isJsonMode()) return;

  // Enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');
  isAlternateScreen = true;
}

/** Update progress display */
export function updateProgress(progress: DownloadProgress[]): void {
  const now = Date.now();
  if (now - lastUpdate < 100) return; // Throttle updates
  lastUpdate = now;

  currentProgress = progress;

  if (isJsonMode()) return;

  const completed = progress.filter((p) => p.status === 'completed').length;
  const failed = progress.filter((p) => p.status === 'failed').length;
  const active = progress.filter((p) => p.status === 'downloading').length;
  const pending = progress.filter((p) => p.status === 'pending').length;

  const width = process.stdout.columns || 80;
  const totalFiles = totalItems;
  const progressPercent = totalFiles > 0 ? Math.round((completed / totalFiles) * 100) : 0;

  // Clear screen using ANSI escape sequences (compatible with alternate buffer)
  // \x1b[2J clears entire screen, \x1b[H moves cursor to top-left
  process.stdout.write('\x1b[2J\x1b[H');

  console.log(chalk.bold.cyan('═'.repeat(Math.min(width, 60))));
  if (abortingFlag) {
    console.log(chalk.bold.yellow('  ⏹ Aborting... waiting for active downloads'));
  } else {
    console.log(chalk.bold('  Download Progress'));
  }
  console.log(chalk.cyan('═'.repeat(Math.min(width, 60))));
  // BUG FIX 1: Add explicit "Files: X/Y (Z%)" progress display
  console.log(chalk.bold(`  Files: ${completed}/${totalFiles} (${progressPercent}%)`));
  console.log(
    `  ${chalk.green('✓')} Completed: ${chalk.green(completed.toString())}  ` +
      `${chalk.red('✗')} Failed: ${chalk.red(failed.toString())}  ` +
      `${chalk.blue('↓')} Active: ${chalk.blue(active.toString())}  ` +
      `${chalk.gray('○')} Pending: ${chalk.gray(pending.toString())}`
  );
  console.log(chalk.cyan('═'.repeat(Math.min(width, 60))));

  // Draw active downloads
  const activeItems = progress.filter((p) => p.status === 'downloading').slice(0, 10);

  for (const item of activeItems) {
    const percent = item.progress.toFixed(1);
    const filename = item.filename.length > 24 ? item.filename.slice(0, 21) + '...' : item.filename;
    const duration = item.startTime ? ((Date.now() - item.startTime) / 1000).toFixed(1) : '0.0';
    const speed = formatBytes(item.bytesDownloaded / Math.max(parseFloat(duration), 1)) + '/s';
    const sizeInfo = formatSizeProgress(item.bytesDownloaded, item.totalBytes);

    const barWidth = 15;
    const filled = Math.min(barWidth, Math.max(0, Math.round((item.progress / 100) * barWidth)));
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    console.log(
      `  ${chalk.blue(bar)} ${chalk.cyan(percent.padStart(5))}%` +
        (sizeInfo ? `  ${chalk.white(sizeInfo.padEnd(12))}` : '              ') +
        `  ${chalk.gray(filename.padEnd(24))} ${chalk.yellow(speed)}`
    );
  }

  // Draw recent completions/failures
  const recentItems = progress
    .filter((p) => p.status === 'completed' || p.status === 'failed')
    .slice(-5);

  if (recentItems.length > 0) {
    console.log(chalk.gray('\n  Recent:'));
    for (const item of recentItems) {
      const icon = item.status === 'completed' ? chalk.green('✓') : chalk.red('✗');
      // Show brief error message in normal mode, full in verbose mode
      let status: string;
      if (item.status === 'completed') {
        status = 'completed';
      } else {
        const errorMsg = item.error || 'failed';
        if (verboseMode) {
          status = errorMsg.slice(0, 35);
        } else {
          // Extract just the error type for brief display
          status = extractBriefError(errorMsg);
        }
      }
      console.log(`    ${icon} ${item.filename.slice(0, 40).padEnd(40)} ${chalk.gray(status)}`);
    }
  }

  console.log(chalk.cyan('═'.repeat(Math.min(width, 60))));
}

/** Extract brief error type from full error message */
function extractBriefError(error: string): string {
  if (!error) return 'Failed';
  if (error.includes('403')) return 'HTTP 403';
  if (error.includes('404')) return 'HTTP 404';
  if (error.includes('500')) return 'HTTP 500';
  if (error.includes('502')) return 'HTTP 502';
  if (error.includes('503')) return 'HTTP 503';
  if (error.includes('timeout') || error.includes('ETIMEDOUT')) return 'Timeout';
  if (error.includes('ECONNREFUSED')) return 'Connection refused';
  if (error.includes('ENOTFOUND')) return 'DNS error';
  if (error.includes('aborted')) return 'Aborted';
  if (error.includes('network')) return 'Network error';
  return 'Failed';
}

/** Stop TUI and restore previous screen */
export function stopTUI(): void {
  if (isAlternateScreen && !isJsonMode()) {
    // Exit alternate screen buffer (restores saved screen automatically)
    process.stdout.write('\x1b[?1049l');
    isAlternateScreen = false;
  }
  currentProgress = [];
}

/** Check if TUI is currently active */
export function isTUIActive(): boolean {
  return isAlternateScreen;
}

/** Set aborting state for TUI display */
export function setAborting(aborting: boolean): void {
  abortingFlag = aborting;
}

/** Format bytes to human readable */
function formatBytes(bytes: number): string {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[Math.min(i, sizes.length - 1)]
  );
}

/** Format download size progress (e.g. "1.3/46.8 MB") using the larger value's unit */
function formatSizeProgress(downloaded: number, total?: number): string {
  if (total && total > 0) {
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(total)) / Math.log(k));
    const unit = sizes[Math.min(i, sizes.length - 1)];
    const dl = parseFloat((downloaded / Math.pow(k, i)).toFixed(1));
    const tl = parseFloat((total / Math.pow(k, i)).toFixed(1));
    return `${dl}/${tl} ${unit}`;
  } else if (downloaded > 0) {
    return formatBytes(downloaded);
  }
  return '';
}

/** Get file type from filename */
function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const typeMap: Record<string, string> = {
    // Images
    jpg: 'image',
    jpeg: 'image',
    png: 'image',
    gif: 'image',
    webp: 'image',
    svg: 'image',
    ico: 'image',
    bmp: 'image',
    // Videos
    mp4: 'video',
    webm: 'video',
    avi: 'video',
    mov: 'video',
    mkv: 'video',
    flv: 'video',
    wmv: 'video',
    // Documents
    pdf: 'pdf',
    doc: 'document',
    docx: 'document',
    ppt: 'document',
    pptx: 'document',
    xls: 'spreadsheet',
    xlsx: 'spreadsheet',
    ods: 'spreadsheet',
    // Data
    csv: 'csv',
    json: 'data',
    xml: 'data',
    // Web
    html: 'html',
    htm: 'html',
    txt: 'text',
    md: 'text',
    rtf: 'text',
  };

  return typeMap[ext] || 'other';
}

/** Group downloads by type */
function groupByType(progress: DownloadProgress[]): Record<string, DownloadProgress[]> {
  const groups: Record<string, DownloadProgress[]> = {};

  for (const item of progress) {
    const type = getFileType(item.filename);
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(item);
  }

  return groups;
}

/** Calculate statistics for a group */
function calculateStats(items: DownloadProgress[]): {
  count: number;
  totalSize: number;
  avgSize: number;
} {
  const count = items.length;
  const totalSize = items.reduce((sum, item) => sum + (item.bytesDownloaded || 0), 0);
  const avgSize = count > 0 ? totalSize / count : 0;
  return { count, totalSize, avgSize };
}

/** Get summary stats */
export function getSummary(): { total: number; completed: number; failed: number; speed: number } {
  const completed = currentProgress.filter((p) => p.status === 'completed').length;
  const failed = currentProgress.filter((p) => p.status === 'failed').length;
  const active = currentProgress.filter((p) => p.status === 'downloading');

  const totalSpeed = active.reduce((sum, p) => {
    const duration = (Date.now() - (p.startTime || Date.now())) / 1000;
    return sum + p.bytesDownloaded / Math.max(duration, 1);
  }, 0);

  return {
    total: totalItems,
    completed,
    failed,
    speed: totalSpeed,
  };
}

/** Print final summary with error details and per-type statistics */
export function printSummary(progress: DownloadProgress[]): void {
  if (isJsonMode()) return;

  const completed = progress.filter((p) => p.status === 'completed');
  const failed = progress.filter((p) => p.status === 'failed');

  const width = process.stdout.columns || 80;
  const separator = chalk.cyan('═'.repeat(Math.min(width, 60)));

  console.log(separator);
  console.log(chalk.bold('  Download Summary'));
  console.log(separator);
  console.log(
    `  ${chalk.green('✓')} Completed: ${chalk.green(completed.length.toString())}    ` +
      `${chalk.red('✗')} Failed: ${chalk.red(failed.length.toString())}    ` +
      `${chalk.blue('◯')} Total: ${totalItems}`
  );

  // Group by type and show per-type statistics
  if (completed.length > 0) {
    console.log('\n  By Type:');
    const byType = groupByType(completed);

    // Sort types by total size (descending)
    const sortedTypes = Object.entries(byType).sort((a, b) => {
      const statsA = calculateStats(a[1]);
      const statsB = calculateStats(b[1]);
      return statsB.totalSize - statsA.totalSize;
    });

    for (const [type, items] of sortedTypes) {
      const stats = calculateStats(items);
      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      const count = stats.count.toString().padStart(3);
      const total = formatBytes(stats.totalSize).padStart(10);
      const avg = formatBytes(stats.avgSize).padStart(8);

      console.log(
        `    ${chalk.cyan(typeLabel.padEnd(12))} ${count} files  ` +
          `(${chalk.yellow(total)} total, ${chalk.gray(avg)} avg)`
      );
    }

    // Overall totals
    const totalStats = calculateStats(completed);
    console.log(
      `\n  ${chalk.bold('Total Downloaded:')} ${chalk.green(formatBytes(totalStats.totalSize))}`
    );
    console.log(
      `  ${chalk.bold('Average File Size:')} ${chalk.gray(formatBytes(totalStats.avgSize))}`
    );
  }

  console.log(separator);

  // Show failed downloads with error details in verbose mode
  if (failed.length > 0 && verboseMode) {
    console.log(chalk.yellow('\n  Failed Downloads:'));
    for (const item of failed.slice(0, 10)) {
      const errorType = extractBriefError(item.error || 'Unknown');
      console.log(
        `    ${chalk.red('✗')} ${item.filename.slice(0, 40).padEnd(40)} ${chalk.gray(errorType)}`
      );
      if (item.error && item.error.length > 0) {
        console.log(`      ${chalk.gray(item.error.slice(0, 60))}`);
      }
    }
    if (failed.length > 10) {
      console.log(`    ${chalk.gray(`... and ${failed.length - 10} more`)}`);
    }
    console.log();
  }
}

/** Print enhanced summary for programmatic use */
export function getEnhancedSummary(progress: DownloadProgress[]): {
  total: number;
  completed: number;
  failed: number;
  byType: Record<string, { count: number; totalSize: number; avgSize: number }>;
  totalSize: number;
  avgSize: number;
} {
  const completed = progress.filter((p) => p.status === 'completed');
  const failed = progress.filter((p) => p.status === 'failed');
  const byType = groupByType(completed);

  const resultByType: Record<string, { count: number; totalSize: number; avgSize: number }> = {};
  for (const [type, items] of Object.entries(byType)) {
    resultByType[type] = calculateStats(items);
  }

  const totalStats = calculateStats(completed);

  return {
    total: totalItems,
    completed: completed.length,
    failed: failed.length,
    byType: resultByType,
    totalSize: totalStats.totalSize,
    avgSize: totalStats.avgSize,
  };
}
