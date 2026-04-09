/**
 * Exports the Commander.js program instance for introspection by the web dashboard.
 * Separated from index.ts so that importing this module does NOT trigger CLI parsing.
 */

import { Command } from 'commander';
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

const program = new Command();

program
  .name('dataset-builder')
  .description(
    'CLI tool for building datasets through web scraping, synthetic data generation, and data sanitization'
  )
  .version('0.1.0');

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

export { program };
