/**
 * Unified TUI (Terminal User Interface) System
 * Provides consistent progress tracking and display across all CLI commands
 */

import chalk from 'chalk';
import { isJsonMode, isQuietMode } from './output';

export interface CounterState {
  urls?: number;
  files?: number;
  records?: number;
  /** Records processed per second */
  throughput?: number;
  /** Currently active parallel LLM requests */
  activeRequests?: number;
  /** Maximum parallel LLM requests */
  maxRequests?: number;
  /** Queue depth (waiting requests) */
  queueDepth?: number;
  [key: string]: number | undefined;
}

export interface ProgressState {
  operation: string;
  taskId?: string;
  phase?: string;
  current: number;
  total?: number;
  counters: CounterState;
  message?: string;
  startTime: number;
  isComplete: boolean;
  error?: string;
  /** Active model name(s) for LLM operations */
  models?: string[];
}

/** LLM processing stats for enhanced progress display */
export interface LLMProgressStats {
  activeRequests: number;
  maxRequests: number;
  queueDepth: number;
  throughput: number;
  models: string[];
}

export class ProgressTracker {
  private state: ProgressState;
  private renderInterval?: NodeJS.Timeout;
  private lastLineCount = 0;
  private isTTY: boolean;
  private lastNdjsonEmit = 0;

  constructor(operation: string, taskId?: string) {
    this.state = {
      operation,
      taskId,
      current: 0,
      counters: {},
      startTime: Date.now(),
      isComplete: false,
    };
    this.isTTY = !!process.stdout.isTTY;
  }

  start(total?: number): void {
    this.state.total = total;
    if (isJsonMode() || isQuietMode()) {
      // Don't render TUI progress in machine/quiet mode
      return;
    }
    this.render();
    this.renderInterval = setInterval(() => this.render(), 250);
  }

  update(current: number, message?: string): void {
    this.state.current = current;
    if (message) {
      this.state.message = message;
    }
  }

  increment(count = 1): void {
    this.state.current += count;
  }

  setCounters(counters: CounterState): void {
    this.state.counters = { ...this.state.counters, ...counters };
  }

  setTotal(total: number): void {
    this.state.total = total;
    this.state.current = 0;
    this.state.startTime = Date.now();
  }

  setPhase(phase: string): void {
    this.state.phase = phase;
  }

  setMessage(msg: string): void {
    this.state.message = msg;
  }

  /**
   * Calculate and set throughput automatically based on records processed.
   * Computes records/sec from elapsed time and sets the throughput counter.
   * Also updates the current progress count.
   * @param processed - Total number of records processed so far
   */
  recordThroughput(processed: number): void {
    const elapsed = Date.now() - this.state.startTime;
    if (elapsed <= 0) return;
    const throughput = Math.round((processed / (elapsed / 1000)) * 100) / 100;
    this.state.counters.throughput = throughput;
    this.state.current = processed;
  }

  /** Update LLM-specific progress stats */
  setLLMStats(stats: LLMProgressStats): void {
    this.state.counters.activeRequests = stats.activeRequests;
    this.state.counters.maxRequests = stats.maxRequests;
    this.state.counters.queueDepth = stats.queueDepth;
    this.state.counters.throughput = Math.round(stats.throughput * 100) / 100;
    this.state.models = stats.models;
  }

  /** Print a log line above the progress block without it being overwritten */
  log(line: string): void {
    if (this.isTTY) {
      this.clearPreviousBlock();
      process.stdout.write(line + '\n');
      this.lastLineCount = 0;
      this.render();
    } else {
      console.log(line);
    }
  }

  complete(summary?: string): void {
    this.state.isComplete = true;
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = undefined;
    }
    this.clearPreviousBlock();
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify({
          type: 'complete',
          phase: this.state.operation,
          duration_ms: Date.now() - this.state.startTime,
          summary: summary ?? null,
          timestamp: new Date().toISOString(),
        }) + '\n'
      );
    }
    this.renderComplete(summary);
  }

  error(message: string): void {
    this.state.error = message;
    this.state.isComplete = true;
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = undefined;
    }
    this.clearPreviousBlock();
    this.renderError();
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private calculateETA(): string | null {
    if (!this.state.total || this.state.current === 0) {
      return null;
    }

    const elapsed = Date.now() - this.state.startTime;
    const rate = this.state.current / elapsed;
    const remaining = this.state.total - this.state.current;
    const etaMs = remaining / rate;

    return this.formatDuration(etaMs);
  }

  private buildProgressBar(width = Math.max(10, (process.stdout.columns || 80) - 40)): string {
    if (!this.state.total || this.state.total === 0) {
      return chalk.gray('[') + chalk.cyan('-'.repeat(width)) + chalk.gray(']');
    }

    const percentage = Math.min(100, Math.floor((this.state.current / this.state.total) * 100));
    const filled = Math.floor((percentage / 100) * width);
    const empty = width - filled;

    const bar =
      chalk.gray('[') +
      chalk.cyan('='.repeat(filled)) +
      chalk.gray('-'.repeat(empty)) +
      chalk.gray(']');

    return `${bar} ${chalk.bold(percentage)}%`;
  }

  private formatCounters(): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(this.state.counters)) {
      if (value !== undefined) {
        parts.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${chalk.cyan(value)}`);
      }
    }

    return parts.join(' | ');
  }

  private truncateLine(line: string): string {
    const cols = process.stdout.columns || 80;
    // Strip ANSI codes to measure visible length
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
    if (stripped.length <= cols) return line;
    // Strip all ANSI, truncate plain text, and append reset code
    // This loses colors but ensures no broken ANSI sequences
    return stripped.slice(0, cols - 1) + '\x1b[0m';
  }

  private clearPreviousBlock(): void {
    if (!this.isTTY || this.lastLineCount === 0) return;
    // Move cursor up N lines and clear each line
    for (let i = 0; i < this.lastLineCount; i++) {
      process.stdout.write('\x1b[1A\x1b[2K');
    }
  }

  private emitNdjsonProgress(): void {
    const now = Date.now();
    if (now - this.lastNdjsonEmit < 500) return; // throttle to 500ms
    this.lastNdjsonEmit = now;

    const counters: Record<string, number> = {};
    for (const [key, value] of Object.entries(this.state.counters)) {
      if (value !== undefined) {
        counters[key] = value;
      }
    }

    const event = {
      type: 'progress' as const,
      phase: this.state.phase || this.state.operation,
      current: this.state.current,
      total: this.state.total,
      message: this.state.message,
      timestamp: new Date().toISOString(),
      ...(Object.keys(counters).length > 0 ? { counters } : {}),
    };
    process.stderr.write(JSON.stringify(event) + '\n');
  }

  private render(): void {
    if (this.state.isComplete) return;

    // In JSON mode: emit NDJSON progress event to stderr instead of TUI
    if (isJsonMode() && !isQuietMode()) {
      this.emitNdjsonProgress();
      return;
    }

    const lines: string[] = [];
    const header = this.state.operation.toUpperCase();
    const taskIdStr = this.state.taskId ? ` (${this.state.taskId.slice(0, 8)}...)` : '';

    lines.push(chalk.cyan('===') + ` ${header}${taskIdStr} ` + chalk.cyan('==='));

    if (this.state.phase) {
      lines.push(`Phase: ${chalk.yellow(this.state.phase)}`);
    }

    if (this.state.total) {
      lines.push(this.buildProgressBar());
      lines.push(`Progress: ${this.state.current}/${this.state.total}`);
    } else if (this.state.current > 0) {
      lines.push(`Progress: ${this.state.current} items`);
    }

    // LLM stats line
    if (
      this.state.counters.activeRequests !== undefined ||
      this.state.counters.throughput !== undefined
    ) {
      const llmParts: string[] = [];
      if (this.state.counters.throughput !== undefined) {
        llmParts.push(`${chalk.cyan(this.state.counters.throughput)} rec/s`);
      }
      if (
        this.state.counters.activeRequests !== undefined &&
        this.state.counters.maxRequests !== undefined
      ) {
        llmParts.push(
          `Parallel: ${chalk.cyan(this.state.counters.activeRequests)}/${this.state.counters.maxRequests}`
        );
      }
      if (this.state.counters.queueDepth !== undefined && this.state.counters.queueDepth > 0) {
        llmParts.push(`Queue: ${chalk.yellow(this.state.counters.queueDepth)}`);
      }
      if (this.state.models && this.state.models.length > 0) {
        llmParts.push(`Model: ${chalk.gray(this.state.models.join(', '))}`);
      }
      if (llmParts.length > 0) {
        lines.push(llmParts.join(' | '));
      }
    }

    const countersStr = this.formatCounters();
    if (countersStr) {
      lines.push(countersStr);
    }

    if (this.state.message) {
      lines.push(chalk.gray(this.state.message));
    }

    const duration = Date.now() - this.state.startTime;
    const eta = this.calculateETA();
    const etaStr = eta ? ` | ETA: ${eta}` : '';
    lines.push(chalk.gray(`Duration: ${this.formatDuration(duration)}${etaStr}`));

    if (this.isTTY) {
      // In-place update: clear previous block, then write new lines
      this.clearPreviousBlock();
      const truncated = lines.map((l) => this.truncateLine(l));
      process.stdout.write(truncated.join('\n') + '\n');
      this.lastLineCount = truncated.length;
    } else {
      // Non-TTY: print once on first render, skip subsequent interval renders
      if (this.lastLineCount === 0) {
        console.log(lines.join('\n'));
        this.lastLineCount = lines.length;
      }
    }
  }

  private renderComplete(summary?: string): void {
    if (isJsonMode()) return;

    const lines: string[] = [];
    const header = this.state.operation.toUpperCase();

    lines.push(
      chalk.green('===') + ` ${header} ` + chalk.green('COMPLETE') + ' ' + chalk.green('===')
    );

    const duration = Date.now() - this.state.startTime;
    lines.push(`Duration: ${this.formatDuration(duration)}`);

    if (summary) {
      lines.push(chalk.green(summary));
    }

    console.log(lines.join('\n'));
  }

  private renderError(): void {
    if (isJsonMode()) return;

    const lines: string[] = [];
    const header = this.state.operation.toUpperCase();

    lines.push(chalk.red('===') + ` ${header} ` + chalk.red('ERROR') + ' ' + chalk.red('==='));

    const duration = Date.now() - this.state.startTime;
    lines.push(`Duration: ${this.formatDuration(duration)}`);

    if (this.state.error) {
      lines.push(chalk.red(`Error: ${this.state.error}`));
    }

    console.log(lines.join('\n'));
  }

  stop(): void {
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = undefined;
    }
    // Leave the last rendered block visible so the user can see final progress state
    // Ensure cursor is on a clean line so subsequent output doesn't overwrite the prompt
    if (this.isTTY) {
      process.stdout.write('\n');
    }
  }
}

export class ProgressSpinner {
  private text: string;
  private spinnerChars = ['-', '\\', '|', '/'];
  private spinnerIndex = 0;
  private interval?: NodeJS.Timeout;
  private isTTY: boolean;
  private lastNdjsonEmit = 0;

  constructor(text = 'Loading...') {
    this.text = text;
    this.isTTY = !!process.stdout.isTTY;
  }

  start(): void {
    if (isQuietMode()) {
      // Don't render spinner in quiet mode
      return;
    }
    if (isJsonMode()) {
      // In JSON mode, emit a single NDJSON progress event for the spinner
      const event = {
        type: 'progress' as const,
        phase: 'spinner',
        current: 0,
        message: this.text,
        timestamp: new Date().toISOString(),
      };
      process.stderr.write(JSON.stringify(event) + '\n');
      this.lastNdjsonEmit = Date.now();
      return;
    }
    if (this.isTTY) {
      this.interval = setInterval(() => {
        process.stdout.write(
          `\r\x1b[2K${chalk.cyan(this.spinnerChars[this.spinnerIndex])} ${this.text}`
        );
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerChars.length;
      }, 100);
    } else {
      // Non-TTY: print once
      console.log(`- ${this.text}`);
    }
  }

  update(text: string): void {
    const changed = this.text !== text;
    this.text = text;
    // In JSON mode, re-emit a progress event when the spinner text changes so
    // the executor (and downstream live logs panel) can show phase transitions.
    if (changed && isJsonMode() && !isQuietMode()) {
      const event = {
        type: 'progress' as const,
        phase: 'spinner',
        current: 0,
        message: text,
        timestamp: new Date().toISOString(),
      };
      process.stderr.write(JSON.stringify(event) + '\n');
      this.lastNdjsonEmit = Date.now();
    }
  }

  stop(success = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (isJsonMode() || isQuietMode()) return;
    const icon = success ? chalk.green('✓') : chalk.red('✗');
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[2K${icon} ${this.text}\n`);
    } else {
      console.log(`${success ? '✓' : '✗'} ${this.text}`);
    }
  }
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

/**
 * Render a color-coded summary of succeeded/failed/skipped counts.
 * Respects JSON and quiet modes — outputs nothing in those modes.
 */
export function renderSummary(succeeded: number, failed: number, skipped: number): void {
  if (isJsonMode() || isQuietMode()) return;

  const total = succeeded + failed + skipped;
  const parts: string[] = [
    chalk.green(`${succeeded} succeeded`),
    chalk.red(`${failed} failed`),
    chalk.yellow(`${skipped} skipped`),
  ];

  console.log(`\nSummary: ${parts.join(', ')} (${total} total)`);
}
