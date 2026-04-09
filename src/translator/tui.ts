/**
 * TUI Progress Display for dataset translation
 * Follows the same alternate-screen pattern as downloader/tui.ts
 */

import chalk from 'chalk';
import { isJsonMode } from '../utils/output';
import type { TranslationProgress, TranslationResult } from './engine';

let isAlternateScreen = false;
let abortingFlag = false;
let lastProgress: TranslationProgress | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Create TUI for translation progress */
export function createTranslationTUI(): void {
  if (isJsonMode()) return;
  // Enter alternate screen buffer
  process.stdout.write('\x1b[?1049h');
  isAlternateScreen = true;

  // Render initial frame so the screen is never blank
  const width = process.stdout.columns || 80;
  const sep = chalk.cyan('\u2550'.repeat(Math.min(width, 60)));
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(sep);
  console.log(chalk.bold('  Dataset Translation'));
  console.log(sep);
  console.log(`  ${chalk.yellow('Starting translation...')}`);
  console.log(sep);

  // Start periodic refresh timer to keep elapsed time ticking
  refreshTimer = setInterval(() => {
    if (lastProgress && isAlternateScreen) {
      renderProgress(lastProgress);
    }
  }, 1000);
}

/** Update translation progress display */
export function updateTranslationProgress(progress: TranslationProgress): void {
  lastProgress = progress;
  renderProgress(progress);
}

/** Render progress to the terminal */
function renderProgress(progress: TranslationProgress): void {
  const now = Date.now();
  const width = process.stdout.columns || 80;
  const barWidth = Math.min(width - 10, 50);

  // Overall progress
  const totalWork = progress.totalRecords * progress.totalLanguages;
  const totalDone =
    progress.currentLanguageIndex * progress.totalRecords + progress.recordsCompleted;
  const overallPercent = totalWork > 0 ? Math.round((totalDone / totalWork) * 100) : 0;
  const filled = Math.min(barWidth, Math.max(0, Math.round((overallPercent / 100) * barWidth)));
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);

  const elapsed = (now - progress.startTime) / 1000;
  const eta = progress.estimatedTimeRemaining / 1000;

  // Clear screen
  process.stdout.write('\x1b[2J\x1b[H');

  const sep = chalk.cyan('\u2550'.repeat(Math.min(width, 60)));

  console.log(sep);
  if (abortingFlag) {
    console.log(chalk.bold.yellow('  Aborting... finishing current batch'));
  } else {
    console.log(chalk.bold('  Dataset Translation'));
  }
  console.log(sep);
  console.log(`  ${chalk.cyan(bar)} ${overallPercent}%`);
  console.log();
  console.log(
    `  Language: ${chalk.bold(progress.currentLanguage)} (${progress.currentLanguageIndex + 1}/${progress.totalLanguages})`
  );
  console.log(
    `  Records: ${progress.recordsCompleted}/${progress.totalRecords} (${progress.totalRecords > 0 ? Math.round((progress.recordsCompleted / progress.totalRecords) * 100) : 0}%)` +
      (progress.recordsFailed > 0
        ? `  ${chalk.red('\u2717')} Failed: ${progress.recordsFailed}`
        : '')
  );
  console.log(
    `  Batch:   ${progress.currentBatchStart}-${progress.currentBatchEnd} of ${progress.totalRecords}`
  );

  // Show translating status when work is in progress
  if (progress.status === 'translating' && progress.recordsCompleted < progress.totalRecords) {
    console.log(`  Status:  ${chalk.yellow('Translating...')}`);
  } else if (progress.status === 'completed') {
    console.log(`  Status:  ${chalk.green('Completed')}`);
  }

  console.log(`  ETA:     ${formatDuration(eta)}`);
  console.log(`  Elapsed: ${formatDuration(elapsed)}`);
  console.log(sep);
}

/** Stop TUI and restore previous screen */
export function stopTranslationTUI(): void {
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
export function setTranslationAborting(aborting: boolean): void {
  abortingFlag = aborting;
}

/** Check if TUI is active */
export function isTranslationTUIActive(): boolean {
  return isAlternateScreen;
}

/** Print final translation summary */
export function printTranslationSummary(results: TranslationResult[]): void {
  if (isJsonMode()) return;
  const width = process.stdout.columns || 80;
  const sep = chalk.cyan('\u2550'.repeat(Math.min(width, 60)));

  const totalRecords = results.reduce((s, r) => s + r.records.length, 0);
  const totalFailed = results.reduce((s, r) => s + r.failedCount, 0);
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(sep);
  console.log(chalk.bold('  Translation Summary'));
  console.log(sep);
  console.log(`  Languages: ${chalk.bold(results.length.toString())}`);
  console.log(`  Total records translated: ${chalk.green(totalRecords.toString())}`);
  if (totalFailed > 0) {
    console.log(`  Failed: ${chalk.red(totalFailed.toString())}`);
  }
  console.log(`  Total time: ${chalk.yellow(formatDuration(totalDuration / 1000))}`);
  console.log();

  // Per-language breakdown
  for (const result of results) {
    const successCount = result.records.length - result.failedCount;
    const duration = formatDuration(result.duration / 1000);
    console.log(
      `  ${chalk.bold(result.language.name)} (${result.language.code}): ` +
        `${chalk.green(successCount.toString())} translated` +
        (result.failedCount > 0 ? `, ${chalk.red(result.failedCount.toString())} failed` : '') +
        ` in ${chalk.yellow(duration)}`
    );
  }

  console.log(sep);
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
