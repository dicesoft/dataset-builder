/**
 * Detailed structured logging system for dataset-builder operations
 * Creates multiple log files: operations.jsonl, stdout.log, errors.jsonl
 */

import fs from 'fs/promises';
import path from 'path';
import { maskSensitiveFields } from './sanitize';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory = 'scrape' | 'download' | 'search' | 'system' | 'resume';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: {
    url?: string;
    attempt?: number;
    statusCode?: number;
    errorType?: string;
    errorMessage?: string;
    duration?: number;
    bytesDownloaded?: number;
    totalBytes?: number;
    sourceUrl?: string;
    depth?: number;
    sourceChain?: string[];
    taskId?: string;
    fileType?: string;
    fileSize?: number;
    [key: string]: unknown;
  };
}

export interface LoggerOptions {
  taskDir: string;
  taskId?: string;
  taskType?: 'scrape' | 'generate' | 'resume' | 'clean' | 'import' | 'export';
  verbose?: boolean;
}

export class DetailedLogger {
  private logDir: string;
  private taskId: string;
  private verbose: boolean;
  private operationsFile: string;
  private stdoutFile: string;
  private errorsFile: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: LoggerOptions) {
    this.logDir = path.join(options.taskDir, 'logs');
    this.taskId = options.taskId || 'unknown';
    this.verbose = options.verbose || false;
    this.operationsFile = path.join(this.logDir, 'operations.jsonl');
    this.stdoutFile = path.join(this.logDir, 'stdout.log');
    this.errorsFile = path.join(this.logDir, 'errors.jsonl');
  }

  /** Initialize log directory and files */
  async initialize(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });

    // Write headers to stdout.log
    const header = `[${new Date().toISOString()}] Task: ${this.taskId}\n${'='.repeat(60)}\n`;
    await fs.writeFile(this.stdoutFile, header, 'utf-8');

    // Create empty JSONL files
    await fs.writeFile(this.operationsFile, '', 'utf-8');
    await fs.writeFile(this.errorsFile, '', 'utf-8');
  }

  /** Log an operation entry */
  log(entry: Omit<LogEntry, 'timestamp'>): void {
    const fullEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      details: entry.details
        ? (maskSensitiveFields(entry.details as Record<string, unknown>) as LogEntry['details'])
        : entry.details,
    };

    // Queue writes to avoid race conditions
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        // Write to operations.jsonl
        const line = JSON.stringify(fullEntry) + '\n';
        await fs.appendFile(this.operationsFile, line, 'utf-8');

        // Write to stdout.log (human readable)
        const humanLine = this.formatHumanReadable(fullEntry);
        await fs.appendFile(this.stdoutFile, humanLine + '\n', 'utf-8');

        // Write to errors.jsonl if error level
        if (entry.level === 'error') {
          await fs.appendFile(this.errorsFile, line, 'utf-8');
        }

        // Also console output if verbose
        if (this.verbose) {
          console.log(`[${entry.category}] ${entry.message}`);
        }
      } catch (err) {
        console.error('Failed to write log:', err);
      }
    });
  }

  /** Convenience methods for different log levels */
  info(message: string, category: LogCategory, details?: LogEntry['details']): void {
    this.log({ level: 'info', category, message, details });
  }

  warn(message: string, category: LogCategory, details?: LogEntry['details']): void {
    this.log({ level: 'warn', category, message, details });
  }

  error(message: string, category: LogCategory, details?: LogEntry['details']): void {
    this.log({ level: 'error', category, message, details });
  }

  debug(message: string, category: LogCategory, details?: LogEntry['details']): void {
    if (this.verbose) {
      this.log({ level: 'debug', category, message, details });
    }
  }

  /** Log download attempt */
  logDownloadAttempt(url: string, sourceUrl: string | undefined, attempt: number): void {
    this.info('Download attempt started', 'download', {
      url,
      sourceUrl,
      attempt,
    });
  }

  /** Log download completion */
  logDownloadComplete(
    url: string,
    filePath: string,
    fileSize: number,
    duration: number,
    fileType?: string
  ): void {
    this.info('Download completed', 'download', {
      url,
      filePath,
      fileSize,
      duration,
      fileType,
    });
  }

  /** Log download failure */
  logDownloadFailure(
    url: string,
    error: Error | string,
    attempt: number,
    statusCode?: number
  ): void {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorType = this.classifyError(errorMessage);

    this.error('Download failed', 'download', {
      url,
      attempt,
      statusCode,
      errorType,
      errorMessage,
    });
  }

  /** Log scrape operation */
  logScrape(url: string, depth: number, sourceChain: string[], success: boolean): void {
    if (success) {
      this.info('Scrape completed', 'scrape', {
        url,
        depth,
        sourceChain,
      });
    } else {
      this.error('Scrape failed', 'scrape', {
        url,
        depth,
        sourceChain,
      });
    }
  }

  /** Log search operation */
  logSearch(query: string, provider: string, resultsCount: number): void {
    this.info('Search completed', 'search', {
      query,
      provider,
      resultsCount,
    });
  }

  /** Log resume operation */
  logResume(taskDir: string, existingCount: number, pendingCount: number): void {
    this.info('Resume operation started', 'resume', {
      taskDir,
      existingCount,
      pendingCount,
    });
  }

  /** Format entry for human-readable output */
  private formatHumanReadable(entry: LogEntry): string {
    const timestamp = entry.timestamp;
    const level = entry.level.toUpperCase().padEnd(5);
    const category = entry.category.toUpperCase().padEnd(8);
    let line = `[${timestamp}] ${level} [${category}] ${entry.message}`;

    if (entry.details) {
      const details: string[] = [];
      if (entry.details.url) details.push(`url=${entry.details.url}`);
      if (entry.details.attempt) details.push(`attempt=${entry.details.attempt}`);
      if (entry.details.statusCode) details.push(`status=${entry.details.statusCode}`);
      if (entry.details.errorType) details.push(`error=${entry.details.errorType}`);
      if (entry.details.duration) details.push(`duration=${entry.details.duration}ms`);
      if (entry.details.bytesDownloaded) {
        details.push(`size=${this.formatBytes(entry.details.bytesDownloaded)}`);
      }
      if (entry.details.depth !== undefined) details.push(`depth=${entry.details.depth}`);

      if (details.length > 0) {
        line += ` (${details.join(', ')})`;
      }
    }

    return line;
  }

  /** Classify error type from message */
  private classifyError(error: string): string {
    if (!error) return 'Unknown';
    if (error.includes('403')) return 'HTTP_403';
    if (error.includes('404')) return 'HTTP_404';
    if (error.includes('500')) return 'HTTP_500';
    if (error.includes('502')) return 'HTTP_502';
    if (error.includes('503')) return 'HTTP_503';
    if (error.includes('timeout') || error.includes('ETIMEDOUT')) return 'Timeout';
    if (error.includes('ECONNREFUSED')) return 'ConnectionRefused';
    if (error.includes('ENOTFOUND')) return 'DNS_Error';
    if (error.includes('EAI_AGAIN')) return 'DNS_Lookup_Failed';
    if (error.includes('ECONNRESET')) return 'ConnectionReset';
    if (error.includes('EPIPE')) return 'BrokenPipe';
    if (error.includes('aborted')) return 'Aborted';
    if (error.includes('network')) return 'NetworkError';
    return 'Unknown';
  }

  /** Format bytes to human readable */
  private formatBytes(bytes: number): string {
    if (bytes === 0 || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return (
      parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[Math.min(i, sizes.length - 1)]
    );
  }

  /** Get log file paths */
  getLogPaths(): { operations: string; stdout: string; errors: string } {
    return {
      operations: this.operationsFile,
      stdout: this.stdoutFile,
      errors: this.errorsFile,
    };
  }

  /** Flush all pending writes */
  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

/** Format task start time display */
export function formatTaskStartTime(date?: Date): string {
  return (date || new Date()).toISOString();
}
