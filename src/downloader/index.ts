/**
 * Multi-threaded file downloader with concurrency control
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getConfig } from '../config';
import { createTUI, updateProgress, stopTUI, printSummary, setAborting } from './tui';
import { handleFileDownload } from './fileHandler';
import { isYouTubeUrl, isYouTubePlaylist } from './videoHandler';
import { isJsonMode } from '../utils/output';
import {
  DownloadItem,
  DownloadProgress,
  YouTubeOptions,
  DownloaderOptions,
  DownloadLogger,
  AssetRecord,
} from './types';
import { buildAssetRecord } from './manifest-utils';

// Re-export types for backward compatibility
export {
  DownloadItem,
  DownloadProgress,
  YouTubeOptions,
  DownloaderOptions,
  DownloadLogger,
  AssetRecord,
};

export class Downloader extends EventEmitter {
  private queue: DownloadItem[] = [];
  private active: Map<number, DownloadProgress> = new Map();
  private completed: DownloadProgress[] = [];
  private failed: DownloadProgress[] = [];
  private concurrent: number;
  private ytConcurrent: number;
  private outputDir: string;
  private retry: number;
  private timeout: number;
  private verbose: boolean;
  private running = false;
  private aborting = false;
  private abortController = new AbortController();
  private logger?: DownloadLogger; // BUG FIX 4: Optional logger for detailed logging
  private youtubeOptions?: YouTubeOptions;
  private manifestRecords: AssetRecord[] = []; // Asset manifest records

  constructor(options: DownloaderOptions = {}) {
    super();
    const config = getConfig();

    this.concurrent = options.concurrent || config.get('maxConcurrent');
    this.ytConcurrent = options.ytConcurrent || config.get('ytConcurrent') || 1;
    this.outputDir = options.outputDir || config.get('outputDir');
    this.retry = options.retry ?? 0;
    this.timeout = options.timeout || 30000;
    this.verbose = options.verbose || false;
    this.logger = options.logger; // BUG FIX 4: Store logger for per-file logging
    this.youtubeOptions = options.youtubeOptions;

    // Prevent ERR_UNHANDLED_ERROR by adding a default error listener
    this.on('error', () => {
      // Errors are already tracked in this.failed, no need to crash
    });
  }

  /** Add URLs to download queue */
  add(items: DownloadItem[]): void {
    this.queue.push(...items);
  }

  /** Add a single URL */
  addOne(item: DownloadItem): void {
    this.queue.push(item);
  }

  /** Start downloading */
  async start(): Promise<{ completed: DownloadProgress[]; failed: DownloadProgress[] }> {
    if (this.running) {
      throw new Error('Downloader already running');
    }

    this.running = true;
    this.abortController = new AbortController();
    const total = this.queue.length;

    if (!isJsonMode()) {
      console.log(
        `\nStarting download of ${total} files (concurrent: ${this.concurrent}, yt-concurrent: ${this.ytConcurrent})\n`
      );
    }

    // Create output directory and type-based subdirectories
    const subdirs = [
      'downloads/images',
      'downloads/videos',
      'downloads/pdfs',
      'downloads/documents',
      'downloads/csv',
      'downloads/html',
      'downloads/other',
    ];
    for (const subdir of subdirs) {
      const dir = path.join(this.outputDir, subdir);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Initialize TUI
    createTUI(total, this.verbose);

    // Periodic TUI refresh to keep display alive during long downloads
    const refreshInterval = setInterval(() => {
      const allProgress = [...this.completed, ...this.failed, ...Array.from(this.active.values())];
      updateProgress(allProgress);
    }, 200);

    // Process queue — scan for eligible items respecting per-type concurrency
    const isYT = (url: string) => isYouTubeUrl(url) || isYouTubePlaylist(url);

    const processNext = async (): Promise<void> => {
      while (this.queue.length > 0) {
        const ytActive = [...this.active.values()].filter((p) => isYT(p.url)).length;
        const regActive = this.active.size - ytActive;

        let found = false;
        for (let i = 0; i < this.queue.length; i++) {
          const item = this.queue[i];
          if (isYT(item.url)) {
            if (ytActive >= this.ytConcurrent) continue; // YT slots full, skip
          } else {
            if (regActive >= this.concurrent) continue; // Regular slots full, skip
          }

          // Found an eligible item — remove from queue and start it
          this.queue.splice(i, 1);
          found = true;

          const progress: DownloadProgress = {
            index: item.index,
            url: item.url,
            filename: item.filename
              ? this.sanitizeFilename(item.filename)
              : this.getFilename(item.url, item.type),
            status: 'pending',
            progress: 0,
            bytesDownloaded: 0,
          };

          this.active.set(item.index, progress);
          this.processItem(item, progress).then(
            () => {
              const allProgress = [
                ...this.completed,
                ...this.failed,
                ...Array.from(this.active.values()),
              ];
              updateProgress(allProgress);
              processNext();
            },
            (error) => {
              // Handle any errors that weren't caught in processItem
              // This prevents unhandled promise rejections
              const allProgress = [
                ...this.completed,
                ...this.failed,
                ...Array.from(this.active.values()),
              ];
              updateProgress(allProgress);
              processNext();
            }
          );
          break; // Re-evaluate counts after starting one item
        }

        if (!found) break; // No eligible items can run right now
      }
    };

    // SIGINT handler for graceful abort
    let sigintCount = 0;
    const sigintHandler = () => {
      sigintCount++;
      if (sigintCount === 1) {
        this.cancel();
      } else {
        // Double Ctrl+C — force exit after restoring TUI
        clearInterval(refreshInterval);
        stopTUI();
        const allProgress = [
          ...this.completed,
          ...this.failed,
          ...Array.from(this.active.values()),
        ];
        printSummary(allProgress);
        if (!isJsonMode()) console.log('\nForce exiting...\n');
        // Safety net: ensure exit even if yt-dlp processes linger on Windows
        setTimeout(() => process.exit(1), 500).unref();
        process.exit(1);
      }
    };

    process.on('SIGINT', sigintHandler);

    try {
      await processNext();

      // Wait for all to complete (break early if aborting — signals already sent)
      while (this.active.size > 0) {
        if (this.aborting) {
          // Give in-flight downloads a brief moment to react to the abort signal
          await new Promise((r) => setTimeout(r, 500));
          // Mark any remaining active items as failed/aborted
          for (const [index, progress] of this.active) {
            progress.status = 'failed';
            progress.error = 'Aborted';
            progress.endTime = Date.now();
            this.failed.push(progress);
          }
          this.active.clear();
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      process.removeListener('SIGINT', sigintHandler);

      // Stop periodic refresh and TUI
      clearInterval(refreshInterval);
      const allProgress = [...this.completed, ...this.failed];
      updateProgress(allProgress);
      stopTUI();
      setAborting(false);
      printSummary(allProgress);

      const wasAborted = this.aborting;
      this.running = false;
      this.aborting = false;

      const skipped = allProgress.filter((p) => p.status === 'skipped').length;
      const failedCount = allProgress.filter((p) => p.status === 'failed').length;
      const summary =
        `\nDownload ${wasAborted ? 'aborted' : 'complete'}: ` +
        `${this.completed.length} succeeded, ${failedCount} failed` +
        (skipped > 0 ? `, ${skipped} skipped` : '') +
        '\n';
      if (!isJsonMode()) console.log(summary);
    }

    return {
      completed: this.completed,
      failed: this.failed,
    };
  }

  /** Get subdirectory for file type */
  private getTypeSubdirectory(type: string): string {
    const mapping: Record<string, string> = {
      image: 'downloads/images',
      video: 'downloads/videos',
      pdf: 'downloads/pdfs',
      docx: 'downloads/documents',
      pptx: 'downloads/documents',
      csv: 'downloads/csv',
      html: 'downloads/html',
      text: 'downloads/other',
    };
    return mapping[type] || 'downloads/other';
  }

  /** Process a single download item */
  private async processItem(item: DownloadItem, progress: DownloadProgress): Promise<void> {
    progress.status = 'downloading';
    progress.startTime = Date.now();

    // Organize files into type-based subdirectories
    const typeSubdir = this.getTypeSubdirectory(item.type);
    const outputPath = path.join(this.outputDir, typeSubdir, progress.filename);

    for (let attempt = 0; attempt <= this.retry; attempt++) {
      // Bail out immediately if aborting
      if (this.aborting) {
        progress.status = 'failed';
        progress.error = 'Aborted';
        progress.endTime = Date.now();
        this.failed.push(progress);
        this.active.delete(progress.index);
        return;
      }

      // BUG FIX 4: Log download attempt
      this.logger?.logDownloadAttempt(item.url, item.sourceUrl, attempt + 1);

      try {
        await handleFileDownload(
          item.url,
          outputPath,
          item.type,
          (bytes, total) => {
            progress.bytesDownloaded = bytes;
            progress.totalBytes = total;
            progress.progress = (total ?? 0) > 0 ? (bytes / (total ?? 1)) * 100 : 0;
          },
          this.timeout,
          this.retry, // retryCount
          item.sourceUrl, // Pass source URL for referer header
          this.youtubeOptions, // Pass YouTube quality/format options
          this.abortController.signal // Abort signal for cancellation
        );

        progress.status = 'completed';
        progress.progress = 100;
        progress.endTime = Date.now();

        // BUG FIX 4: Log download completion with file details
        const duration = progress.endTime - (progress.startTime || progress.endTime);
        try {
          const stats = fs.statSync(outputPath);
          this.logger?.logDownloadComplete(item.url, outputPath, stats.size, duration, item.type);
        } catch {
          // YouTube downloads write to their own directory structure, not outputPath
          this.logger?.logDownloadComplete(item.url, outputPath, 0, duration, item.type);
        }

        this.completed.push(progress);
        this.active.delete(progress.index);

        // Build and add manifest record
        const record = buildAssetRecord(
          {
            url: item.url,
            filename: progress.filename,
            status: 'completed',
            bytesDownloaded: progress.bytesDownloaded,
            startTime: progress.startTime,
            endTime: progress.endTime,
          },
          this.manifestRecords.length,
          item.sourceUrl || item.url,
          item.sourcePageTitle || 'Unknown',
          item.type,
          this.outputDir
        );
        // Add context fields if available
        record.context.altText = item.altText || null;
        record.context.surroundingText = item.surroundingText || null;
        record.context.pageDepth = item.pageDepth || 0;
        this.manifestRecords.push(record);

        this.emit('complete', progress);
        return;
      } catch (error: any) {
        const hasMoreRetries = attempt < this.retry;
        if (hasMoreRetries && this.retry > 0) {
          // Backoff only when retry is enabled
          const is403 = error.message?.includes('403');
          const backoffMs = is403
            ? Math.min(500 * Math.pow(2, attempt), 2000) // 403: 500ms → 1s → 2s (max 2s)
            : Math.min(500 * (attempt + 1), 1500); // Other: 500ms → 1s → 1.5s (max 1.5s)
          await new Promise((r) => setTimeout(r, backoffMs));
        } else {
          progress.status = 'failed';
          progress.error = error.message || 'Unknown error';
          progress.endTime = Date.now();

          // BUG FIX 4: Log download failure
          this.logger?.logDownloadFailure(item.url, error, attempt + 1);

          this.failed.push(progress);
          this.active.delete(progress.index);

          // Build and add manifest record for failed download
          const record = buildAssetRecord(
            {
              url: item.url,
              filename: progress.filename,
              status: 'failed',
              bytesDownloaded: 0,
              startTime: progress.startTime,
              endTime: progress.endTime,
            },
            this.manifestRecords.length,
            item.sourceUrl || item.url,
            item.sourcePageTitle || 'Unknown',
            item.type,
            this.outputDir
          );
          record.context.altText = item.altText || null;
          record.context.surroundingText = item.surroundingText || null;
          record.context.pageDepth = item.pageDepth || 0;
          this.manifestRecords.push(record);

          this.emit('error', progress);
        }
      }
    }
  }

  /** Sanitize a filename by replacing characters illegal on Windows/Linux/macOS */
  private sanitizeFilename(filename: string): string {
    // Replace characters illegal in Windows filenames: < > : " / \ | ? *
    // Also replace control characters (0x00-0x1F) and trailing dots/spaces
    return filename
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/[. ]+$/, '') // Windows disallows trailing dots/spaces
      .slice(0, 255); // Filesystem max filename length
  }

  /** Get filename from URL and type */
  private getFilename(url: string, type: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = path.basename(decodeURIComponent(pathname));

      // Sanitize illegal filesystem characters
      filename = this.sanitizeFilename(filename);

      if (!filename || !path.extname(filename)) {
        const ext = this.getExtension(type);
        filename = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
      }

      return filename;
    } catch {
      return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.bin`;
    }
  }

  /** Get file extension for type */
  private getExtension(type: string): string {
    const extensions: Record<string, string> = {
      image: '.jpg',
      video: '.mp4',
      pdf: '.pdf',
      pptx: '.pptx',
      docx: '.docx',
      csv: '.csv',
      html: '.html',
      text: '.txt',
    };
    return extensions[type] || '.bin';
  }

  /** Get current stats */
  getStats(): { pending: number; active: number; completed: number; failed: number } {
    return {
      pending: this.queue.length,
      active: this.active.size,
      completed: this.completed.length,
      failed: this.failed.length,
    };
  }

  /** Get asset manifest records accumulated during downloads */
  getManifestRecords(): AssetRecord[] {
    return [...this.manifestRecords];
  }

  /** Clear manifest records */
  clearManifestRecords(): void {
    this.manifestRecords = [];
  }

  /** Cancel all downloads — aborts active downloads and clears queue */
  cancel(): void {
    this.aborting = true;
    setAborting(true);

    // Abort all in-flight fetch() calls and kill yt-dlp processes
    this.abortController.abort();

    // Mark all queued items as skipped
    for (const item of this.queue) {
      const progress: DownloadProgress = {
        index: item.index,
        url: item.url,
        filename: item.filename || '',
        status: 'skipped',
        progress: 0,
        bytesDownloaded: 0,
        endTime: Date.now(),
      };
      this.failed.push(progress);
    }
    this.queue = [];
  }
}

/** Download multiple URLs */
export async function downloadMultiple(
  items: DownloadItem[],
  options: DownloaderOptions = {}
): Promise<{ completed: DownloadProgress[]; failed: DownloadProgress[] }> {
  const downloader = new Downloader(options);
  downloader.add(items);
  return downloader.start();
}
