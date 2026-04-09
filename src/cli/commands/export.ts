import { Command } from 'commander';
import chalk from 'chalk';
import { exportDataset } from '../../exporters/index';
import { outputResult, isJsonMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';

export const exportCommand = new Command('export')
  .description('Export data to various formats')
  .requiredOption('-i, --input <path>', 'Input file or directory path')
  .requiredOption('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Output format (json, jsonl, csv)', 'json')
  .option('--pretty', 'Pretty print JSON output', false)
  .option('--flatten', 'Flatten nested objects', false)
  .action(
    wrapAction('export', async (options) => {
      if (!isJsonMode()) {
        console.log(chalk.blue('Exporting dataset...'));
        console.log(chalk.gray(`Input: ${options.input}`));
        console.log(chalk.gray(`Output: ${options.output}`));
        console.log(chalk.gray(`Format: ${options.format}`));
      }

      try {
        await exportDataset({
          inputPath: options.input,
          outputPath: options.output,
          format: options.format,
          pretty: options.pretty,
          flatten: options.flatten,
        });

        if (!isJsonMode()) {
          console.log(chalk.green('Export completed successfully!'));
        }

        outputResult('export', {
          input: options.input,
          output: options.output,
          format: options.format,
        });
      } catch (error) {
        console.error(chalk.red('Error:'), error);
        const message = error instanceof Error ? error.message : String(error);
        // Classify error by type
        if (error instanceof Error && (error as any).code === 'INVALID_INPUT') {
          exitWithCode(ExitCode.INVALID_INPUT, message);
        } else if (
          error instanceof Error &&
          (('code' in error && (error as any).code === 'ENOENT') ||
            message.includes('ECONNREFUSED') ||
            message.includes('ETIMEDOUT'))
        ) {
          exitWithCode(ExitCode.NETWORK_ERROR, message);
        } else {
          exitWithCode(ExitCode.INVALID_INPUT, message);
        }
      }
    })
  );
