import { Command } from 'commander';
import chalk from 'chalk';
import { runPipeline, validatePipelineConfig } from '../../pipeline/runner';
import { outputResult, isJsonMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';

export const runCommand = new Command('run')
  .description('Run a data pipeline from configuration')
  .requiredOption('-c, --config <path>', 'Pipeline configuration file path')
  .option('-v, --verbose', 'Verbose output', false)
  .option('--validate', 'Validate pipeline config without executing', false)
  .action(
    wrapAction('run', async (options) => {
      // Validate-only mode
      if (options.validate) {
        try {
          const result = await validatePipelineConfig(options.config);
          if (result.valid) {
            if (!isJsonMode()) {
              console.log(chalk.green('Pipeline config is valid.'));
            }
            outputResult('run', { valid: true, config: options.config });
          } else {
            if (!isJsonMode()) {
              console.error(chalk.red('Pipeline config validation failed:'));
              for (const err of result.errors || []) {
                console.error(chalk.red(`  - ${err}`));
              }
            }
            outputResult('run', { valid: false, errors: result.errors, config: options.config });
            exitWithCode(
              ExitCode.INVALID_INPUT,
              `Pipeline config validation failed: ${(result.errors || []).join('; ')}`
            );
          }
        } catch (error) {
          if (!isJsonMode()) {
            console.error(chalk.red('Error reading config:'), error);
          }
          exitWithCode(
            ExitCode.INVALID_INPUT,
            error instanceof Error ? error.message : String(error)
          );
        }
        return;
      }

      if (!isJsonMode()) {
        console.log(chalk.blue('Running pipeline...'));
        console.log(chalk.gray(`Config: ${options.config}`));
      }

      try {
        const result = await runPipeline(options.config, options.verbose);

        if (result.success) {
          if (!isJsonMode()) {
            console.log(chalk.green('Pipeline completed successfully!'));
            console.log(chalk.gray(`Steps completed: ${result.stepsCompleted}`));
          }

          outputResult('run', {
            stepsCompleted: result.stepsCompleted,
            config: options.config,
          });
        } else {
          if (!isJsonMode()) {
            console.error(chalk.red('Pipeline failed:'), result.error);
          }
          const errMsg = result.error || 'Pipeline failed';
          // Classify pipeline step failures
          if (errMsg.includes('ECONNREFUSED') || errMsg.includes('Ollama')) {
            exitWithCode(ExitCode.OLLAMA_UNAVAILABLE, errMsg);
          } else if (errMsg.includes('Invalid') || errMsg.includes('not found')) {
            exitWithCode(ExitCode.INVALID_INPUT, errMsg);
          } else {
            exitWithCode(ExitCode.GENERAL_ERROR, errMsg);
          }
        }
      } catch (error) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error:'), error);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && 'exitCode' in error) {
          exitWithCode((error as any).exitCode, message);
        } else {
          exitWithCode(ExitCode.GENERAL_ERROR, message);
        }
      }
    })
  );
