/**
 * TUI Progress Display for LLM generation
 * Follows the same alternate-screen pattern as translator/tui.ts
 */

import chalk from 'chalk';
import { isJsonMode } from '../utils/output';
import type { GenerationMetrics, StructuredResult } from './structured';

let isAlternateScreen = false;
let abortingFlag = false;
let lastProgress: GenerationProgress | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export interface GenerationProgress {
  current: number;
  total: number;
  status: 'generating' | 'repairing' | 'retrying' | 'completed' | 'failed';
  currentAttempt?: number;
  maxRetries?: number;
  startTime: number;
  estimatedTimeRemaining: number;
}

/** Create TUI for generation progress */
export function createGenerateTUI(total: number): void {
  if (isJsonMode()) return;
  // Enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');
  isAlternateScreen = true;

  // Render initial frame so the screen is never blank
  const width = process.stdout.columns || 80;
  const sep = chalk.cyan('\u2550'.repeat(Math.min(width, 60)));
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(sep);
  console.log(chalk.bold('  LLM Generation'));
  console.log(sep);
  console.log(`  ${chalk.yellow('Starting generation...')}`);
  console.log(sep);

  // Start periodic refresh timer to keep elapsed time ticking
  refreshTimer = setInterval(() => {
    if (lastProgress && isAlternateScreen) {
      renderProgress(lastProgress);
    }
  }, 1000);
}

/** Update generation progress display */
export function updateGenerateProgress(progress: GenerationProgress): void {
  lastProgress = progress;
  renderProgress(progress);
}

/** Render progress to the terminal */
function renderProgress(progress: GenerationProgress): void {
  const now = Date.now();
  const width = process.stdout.columns || 80;
  const barWidth = Math.min(width - 10, 50);

  // Calculate percentage
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const filled = Math.min(barWidth, Math.max(0, Math.round((percent / 100) * barWidth)));
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);

  const elapsed = (now - progress.startTime) / 1000;
  const eta = progress.estimatedTimeRemaining / 1000;

  // Clear screen
  process.stdout.write('\x1b[2J\x1b[H');

  const sep = chalk.cyan('\u2550'.repeat(Math.min(width, 60)));

  console.log(sep);
  if (abortingFlag) {
    console.log(chalk.bold.yellow('  Aborting... finishing current record'));
  } else {
    console.log(chalk.bold('  LLM Generation'));
  }
  console.log(sep);
  console.log(`  ${chalk.cyan(bar)} ${percent}%`);
  console.log();
  console.log(`  Records: ${chalk.bold(`${progress.current}/${progress.total}`)}`);

  // Show status with appropriate color
  let statusText: string;
  switch (progress.status) {
    case 'generating':
      statusText = chalk.yellow('Generating...');
      break;
    case 'repairing':
      statusText = chalk.yellow('\ud83d\udd27 Repairing JSON...');
      break;
    case 'retrying':
      statusText = chalk.yellow(
        `\ud83d\udd04 Retrying (${progress.currentAttempt}/${progress.maxRetries})...`
      );
      break;
    case 'completed':
      statusText = chalk.green('\u2713 Completed');
      break;
    case 'failed':
      statusText = chalk.red('\u2717 Failed');
      break;
    default:
      statusText = chalk.gray(progress.status);
  }
  console.log(`  Status:  ${statusText}`);

  // Show retry info if applicable
  if (progress.status === 'retrying' && progress.currentAttempt && progress.maxRetries) {
    console.log(`  Attempt: ${chalk.cyan(`${progress.currentAttempt}/${progress.maxRetries}`)}`);
  }

  console.log(`  ETA:     ${formatDuration(eta)}`);
  console.log(`  Elapsed: ${formatDuration(elapsed)}`);
  console.log(sep);
}

/** Stop TUI and restore previous screen */
export function stopGenerateTUI(): void {
  // Clear the refresh timer
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  lastProgress = null;

  if (isAlternateScreen) {
    process.stdout.write('\x1b[?1049l');
    isAlternateScreen = false;
  }
  abortingFlag = false;
  // Reset cursor to a clean position for post-TUI output
  process.stdout.write('\x1b[0m');
}

/** Set aborting state for TUI display */
export function setGenerateAborting(aborting: boolean): void {
  abortingFlag = aborting;
}

/** Check if TUI is active */
export function isGenerateTUIActive(): boolean {
  return isAlternateScreen;
}

/** Print final generation summary */
export function printGenerationSummary(metrics: GenerationMetrics): void {
  if (isJsonMode()) return;
  const width = process.stdout.columns || 80;
  const sep = chalk.cyan('\u2550'.repeat(Math.min(width, 60)));

  const successRate =
    metrics.targetCount > 0
      ? ((metrics.successCount / metrics.targetCount) * 100).toFixed(1)
      : '0.0';

  console.log(sep);
  console.log(chalk.bold('  Generation Summary'));
  console.log(sep);

  // Count section
  console.log(chalk.blue('\n  \ud83d\udcc8 Counts:'));
  console.log(`    Target:       ${chalk.cyan(metrics.targetCount.toString())}`);
  console.log(`    Successful:   ${chalk.green(metrics.successCount.toString())}`);
  console.log(
    `    Failed:       ${metrics.failedCount > 0 ? chalk.red(metrics.failedCount.toString()) : chalk.gray('0')}`
  );
  console.log(`    Success Rate: ${chalk.green(`${successRate}%`)}`);

  // Timing section
  console.log(chalk.blue('\n  \u23f1\ufe0f  Timing:'));
  console.log(
    `    Total Duration:   ${chalk.cyan(`${(metrics.totalDuration / 1000).toFixed(2)}s`)}`
  );
  console.log(
    `    Average Response: ${chalk.cyan(`${(metrics.averageResponseTime / 1000).toFixed(2)}s`)}`
  );

  // Repair stats
  if (metrics.repairAttempts > 0) {
    console.log(chalk.blue('\n  \ud83d\udd27 JSON Repairs:'));
    console.log(`    Attempts:  ${chalk.yellow(metrics.repairAttempts.toString())}`);
    console.log(`    Successes: ${chalk.green(metrics.repairSuccesses.toString())}`);
    console.log(
      `    Rate:      ${chalk.cyan(`${((metrics.repairSuccesses / metrics.repairAttempts) * 100).toFixed(1)}%`)}`
    );
  }

  // Error breakdown
  const errorTypes = Object.entries(metrics.errorsByType);
  if (errorTypes.length > 0) {
    console.log(chalk.blue('\n  \u26a0\ufe0f  Error Breakdown:'));
    for (const [type, count] of errorTypes) {
      console.log(`    ${type}: ${chalk.red(count.toString())}`);
    }
  }

  console.log(sep);

  // Final status
  if (metrics.successCount === metrics.targetCount) {
    console.log(chalk.green('\n  \u2705 All records generated successfully!'));
  } else if (metrics.successCount > 0) {
    console.log(
      chalk.yellow(
        `\n  \u26a0\ufe0f  Partial success: ${metrics.successCount}/${metrics.targetCount} records generated`
      )
    );
  } else {
    console.log(chalk.red('\n  \u274c Generation failed: No records were created'));
  }
}

/** Format seconds to human-readable duration */
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}
