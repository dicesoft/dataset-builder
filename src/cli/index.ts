#!/usr/bin/env node

import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { setGlobalFlags, outputError, isJsonMode } from '../utils/output';
import { ExitCode, exitWithCode } from '../utils/exitCodes';
import { readStdin } from '../utils/stdin';
import { scrapeCommand } from './commands/scrape';
import { generateCommand } from './commands/generate';
import { importCommand } from './commands/import';
import { exportCommand } from './commands/export';
import { cleanCommand } from './commands/clean';
import { runCommand } from './commands/run';
import { configCommand } from './commands/config';
import { pruneCommand } from './commands/prune';
import { webSearchCommand } from './commands/webSearch';
import { resumeCommand } from './commands/resume';
import { compressCommand } from './commands/compress';
import { translateCommand } from './commands/translate';
import { formatCommand } from './commands/format';
import { transformCommand } from './commands/transform';
import { webCommand } from './commands/web';

const program = new Command();

program
  .name('dataset-builder')
  .description(
    'CLI tool for building datasets through web scraping, synthetic data generation, and data sanitization'
  )
  .version('0.1.0')
  .enablePositionalOptions()
  .option('--verbose', 'Enable verbose logging for detailed output')
  .option('--json', 'Output results as JSON to stdout (logs go to stderr)')
  .option('--quiet', 'Suppress progress/status output')
  .option('--yes', 'Auto-accept all confirmation prompts')
  .option('--dry-run', 'Preview operations without executing')
  .option('--stdin', 'Read options as JSON from stdin')
  .exitOverride()
  .hook('preAction', async (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) process.env.VERBOSE = 'true';
    if (opts.json) process.env.JSON_OUTPUT = 'true';
    if (opts.quiet) process.env.QUIET = 'true';
    if (opts.yes) process.env.YES = 'true';
    if (opts.dryRun) process.env.DRY_RUN = 'true';

    setGlobalFlags({
      json: !!opts.json,
      quiet: !!opts.quiet,
      yes: !!opts.yes,
      verbose: !!opts.verbose,
      dryRun: !!opts.dryRun,
    });

    // Handle --stdin: read JSON from stdin and merge with command options
    if (opts.stdin) {
      const stdinData = await readStdin();
      if (stdinData) {
        let stdinOpts: Record<string, unknown>;
        try {
          stdinOpts = JSON.parse(stdinData);
        } catch {
          if (isJsonMode()) {
            outputError('INVALID_INPUT', 'Invalid JSON on stdin', { raw: stdinData.slice(0, 200) });
          } else {
            console.error(chalk.red('Error: Invalid JSON on stdin'));
          }
          exitWithCode(ExitCode.INVALID_INPUT, 'Invalid JSON on stdin');
        }

        if (typeof stdinOpts! !== 'object' || stdinOpts! === null || Array.isArray(stdinOpts!)) {
          if (isJsonMode()) {
            outputError('INVALID_INPUT', 'stdin JSON must be a plain object');
          } else {
            console.error(chalk.red('Error: stdin JSON must be a plain object'));
          }
          exitWithCode(ExitCode.INVALID_INPUT, 'stdin JSON must be a plain object');
        }

        // Find the subcommand being executed
        const subcommand =
          thisCommand.commands?.find((c: Command) => c.name() === thisCommand.args?.[0]) ||
          thisCommand;

        // Get known option names from the subcommand
        const knownOptionNames = new Set<string>();
        for (const opt of subcommand.options || []) {
          // Commander stores long option as e.g. '--search-count <n>' -> attributeName 'searchCount'
          knownOptionNames.add(opt.attributeName());
          // Also accept the long flag name (kebab-case without --)
          if (opt.long) {
            knownOptionNames.add(opt.long.replace(/^--/, ''));
          }
        }

        // Validate and merge stdin options
        for (const [key, value] of Object.entries(stdinOpts!)) {
          const camelKey = key.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());

          // Check if key is known (either camelCase or kebab-case)
          if (
            knownOptionNames.size > 0 &&
            !knownOptionNames.has(camelKey) &&
            !knownOptionNames.has(key)
          ) {
            const available = [...knownOptionNames].sort().join(', ');
            const msg = `Unknown stdin option: "${key}". Known options: ${available}`;
            if (isJsonMode()) {
              outputError('INVALID_INPUT', msg);
            } else {
              console.error(chalk.red(`Error: ${msg}`));
            }
            exitWithCode(ExitCode.INVALID_INPUT, msg);
          }

          // Only set if not already explicitly provided on CLI
          if (subcommand.getOptionValue(camelKey) === undefined) {
            subcommand.setOptionValue(camelKey, value);
          }
        }
      }
    }
  });

// Register commands
program.addCommand(scrapeCommand);
program.addCommand(generateCommand);
program.addCommand(importCommand);
program.addCommand(exportCommand);
program.addCommand(cleanCommand);
program.addCommand(runCommand);
program.addCommand(configCommand);
program.addCommand(pruneCommand);
program.addCommand(webSearchCommand);
program.addCommand(resumeCommand);
program.addCommand(compressCommand);
program.addCommand(translateCommand);
program.addCommand(formatCommand);
program.addCommand(transformCommand);
program.addCommand(webCommand);

program.on('command:*', () => {
  const msg = `Invalid command: ${program.args.join(' ')}`;
  if (isJsonMode()) {
    outputError('INVALID_INPUT', msg);
  } else {
    console.error(chalk.red(msg));
    console.log(chalk.yellow(`Run 'dataset-builder --help' for available commands.`));
  }
  process.exit(ExitCode.INVALID_INPUT);
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander.js errors (help, version, missing args, unknown options)
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.help' ||
        error.code === 'commander.version'
      ) {
        // Help and version are not errors; exit cleanly
        process.exit(ExitCode.SUCCESS);
      }
      // Arg parsing errors (missing required, unknown option, etc.)
      if (isJsonMode()) {
        outputError('INVALID_INPUT', error.message, { code: error.code });
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(ExitCode.INVALID_INPUT);
    }

    // Generic error fallback
    const message = error instanceof Error ? error.message : String(error);
    if (isJsonMode()) {
      outputError('GENERAL_ERROR', message);
    } else {
      console.error(chalk.red('Error:'), message);
    }
    process.exit(ExitCode.GENERAL_ERROR);
  }
}

main();
