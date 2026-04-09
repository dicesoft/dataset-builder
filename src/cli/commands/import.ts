import { Command } from 'commander';
import chalk from 'chalk';
import { importFile } from '../../importers/index';
import { outputResult, isJsonMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';

export const importCommand = new Command('import')
  .description('Import data from files (CSV, JSON, XML, XLS, TXT, HTML)')
  .requiredOption('-f, --file <path>', 'Input file path')
  .option('-o, --output <path>', 'Output file path (optional)')
  .option('-t, --type <type>', 'File type override (csv, json, xml, xls, txt, html)', 'auto')
  .option('--encoding <encoding>', 'File encoding', 'utf-8')
  .option('--delimiter <char>', 'CSV delimiter', ',')
  .action(
    wrapAction('import', async (options) => {
      if (!isJsonMode()) {
        console.log(chalk.blue('Importing file...'));
        console.log(chalk.gray(`File: ${options.file}`));
        console.log(chalk.gray(`Type: ${options.type}`));
      }

      try {
        const result = await importFile({
          filePath: options.file,
          type: options.type,
          encoding: options.encoding,
          delimiter: options.delimiter,
        });

        if (options.output) {
          const fs = await import('fs/promises');
          await fs.writeFile(options.output, JSON.stringify(result, null, 2), 'utf-8');
          if (!isJsonMode()) {
            console.log(chalk.green(`Data written to: ${options.output}`));
          }
        } else if (!isJsonMode()) {
          console.log(chalk.gray('\nImported data:'));
          console.log(JSON.stringify(result.slice(0, 5), null, 2));
          if (result.length > 5) {
            console.log(chalk.gray(`... and ${result.length - 5} more records`));
          }
        }

        if (!isJsonMode()) {
          console.log(chalk.green(`Imported ${result.length} records successfully!`));
        }

        outputResult('import', {
          records: result.length,
          file: options.file,
          type: options.type,
          outputFile: options.output || null,
        });
      } catch (error) {
        console.error(chalk.red('Error:'), error);
        const message = error instanceof Error ? error.message : String(error);
        // Unsupported file type or parse errors are input errors
        if (message.includes('Unsupported file type') || message.includes('Invalid JSON')) {
          exitWithCode(ExitCode.INVALID_INPUT, message);
        } else if (error instanceof Error && 'exitCode' in error) {
          exitWithCode((error as any).exitCode, message);
        } else {
          exitWithCode(ExitCode.INVALID_INPUT, message);
        }
      }
    })
  );
