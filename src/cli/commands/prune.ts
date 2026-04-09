/**
 * Prune command - Clean output files by age or pattern
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config';
import { outputResult, isJsonMode, getGlobalFlags, isYesMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';

export const pruneCommand = new Command('prune')
  .description('Clean output files by age or pattern')
  .requiredOption('-p, --pattern <pattern>', 'File pattern to match (e.g., *.json, output/*)')
  .option('-d, --days <days>', 'Delete files older than N days', '0')
  .option('--dry-run', 'Show what would be deleted without actually deleting', false)
  .option('-f, --force', 'Force deletion without confirmation', false)
  .option('-r, --recursive', 'Search recursively', true)
  .action(
    wrapAction('prune', async (options) => {
      const config = getConfig();
      const { pattern, days, dryRun, force, recursive } = options;

      const outputDir = config.get('outputDir');
      const daysNum = parseInt(days, 10);

      if (isNaN(daysNum)) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: --days must be a number'));
        }
        exitWithCode(ExitCode.INVALID_INPUT, '--days must be a number');
      }

      // Resolve the pattern - treat as relative to outputDir
      const searchPath = path.isAbsolute(pattern) ? pattern : path.resolve(outputDir, pattern);

      if (!isJsonMode()) {
        console.log(chalk.bold(`\nPrune Configuration:`));
        console.log(`  Pattern: ${chalk.cyan(pattern)}`);
        console.log(`  Search path: ${chalk.cyan(searchPath)}`);
        console.log(`  Days threshold: ${chalk.cyan(daysNum)}`);
        console.log(`  Dry run: ${chalk.cyan(dryRun)}`);
        console.log(`  Recursive: ${chalk.cyan(recursive)}\n`);
      }

      // Find matching files
      const files = await findMatchingFiles(searchPath, recursive);
      const now = Date.now();
      const ageMs = daysNum * 24 * 60 * 60 * 1000;

      const filesToDelete: { file: string; age: number }[] = [];

      for (const file of files) {
        try {
          const stats = fs.statSync(file);
          const age = now - stats.mtimeMs;

          if (ageMs === 0 || age > ageMs) {
            filesToDelete.push({
              file,
              age: Math.round(age / (24 * 60 * 60 * 1000)),
            });
          }
        } catch (err) {
          if (!isJsonMode()) {
            console.log(chalk.yellow(`  Skipping (error): ${file}`));
          }
        }
      }

      if (filesToDelete.length === 0) {
        if (!isJsonMode()) {
          console.log(chalk.yellow('No files found matching criteria.'));
        }
        outputResult('prune', { files_removed: 0 });
        return;
      }

      if (!isJsonMode()) {
        // Display files to delete
        console.log(chalk.bold(`\nFiles to ${dryRun ? 'delete (dry-run)' : 'delete'}:`));
        console.log(chalk.gray('─'.repeat(60)));

        for (const { file, age } of filesToDelete) {
          console.log(`  ${chalk.red('✗')} ${file} ${chalk.gray(`(${age} days old)`)}`);
        }

        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.bold(`Total: ${filesToDelete.length} files\n`));
      }

      if (dryRun || getGlobalFlags().dryRun) {
        if (!isJsonMode()) {
          console.log(chalk.yellow('Dry run - no files were deleted.'));
        }
        outputResult('prune', {
          dry_run: true,
          command: 'prune',
          planned_actions: filesToDelete.map((f) => `Delete: ${f.file} (${f.age} days old)`),
          estimated: { files: filesToDelete.length },
        });
        return;
      }

      if (!force && !isYesMode()) {
        const { confirm } = await import('../../utils/confirm');
        const confirmed = await confirm(`Delete ${filesToDelete.length} files?`, false);
        if (!confirmed) {
          if (!isJsonMode()) {
            console.log(chalk.yellow('Cancelled.'));
          }
          return;
        }
      }

      // Delete files
      let deleted = 0;
      let errors = 0;

      for (const { file } of filesToDelete) {
        try {
          fs.unlinkSync(file);
          deleted++;
        } catch (err) {
          errors++;
          if (!isJsonMode()) {
            console.log(chalk.red(`  Error deleting: ${file}`));
          }
        }
      }

      if (!isJsonMode()) {
        console.log(chalk.green(`\nDeleted ${deleted} files.`));
        if (errors > 0) {
          console.log(chalk.red(`Failed to delete ${errors} files.`));
        }
      }

      outputResult('prune', {
        deleted,
        errors,
        total: filesToDelete.length,
      });
    })
  );

/**
 * Find files matching a pattern
 */
async function findMatchingFiles(searchPath: string, recursive: boolean): Promise<string[]> {
  const files: string[] = [];
  const dir = path.dirname(searchPath);
  const pattern = path.basename(searchPath);

  // Convert glob-like pattern to regex
  const regexPattern = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  const regex = new RegExp(regexPattern, 'i');

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && regex.test(entry.name)) {
        files.push(fullPath);
      } else if (entry.isDirectory() && recursive) {
        const subFiles = await findMatchingFiles(path.join(fullPath, pattern), recursive);
        files.push(...subFiles);
      }
    }
  } catch (err) {
    // Directory doesn't exist or not accessible
  }

  return files;
}

pruneCommand.addHelpText(
  'after',
  `
Examples:
  $ prune -p "*.json" -d 7              Delete JSON files older than 7 days
  $ prune -p "output/*" --dry-run        Show what would be deleted
  $ prune -p "*.log" -f                  Force delete without prompt
  $ prune -p "**/*.tmp" -d 0             Delete all .tmp files recursively
`
);
