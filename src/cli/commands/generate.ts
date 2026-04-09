import { Command, Option } from 'commander';
import chalk from 'chalk';
import { faker } from '@faker-js/faker';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { generateSyntheticData } from '../../generators/faker';
import {
  generateStructuredBatch,
  generateSchemaFromDescription,
  GenerationMetrics,
} from '../../generators/structured';
import {
  createGenerateTUI,
  updateGenerateProgress,
  stopGenerateTUI,
  printGenerationSummary,
  type GenerationProgress,
} from '../../generators/tui';
import { getOllama } from '../../generators/ollama';
import { webSearch, formatSearchResultsAsContext } from '../../generators/webSearch';
import { getConfig } from '../../config';
import {
  generateTaskId,
  createTaskStructure,
  createTaskMetadata,
  updateTaskStatus,
  getTaskFilePath,
} from '../../utils/taskManager';
import { safeJsonParse } from '../../utils/json';
import fs from 'fs/promises';
import path from 'path';
import {
  CommandCheckpoint,
  saveCommandCheckpoint,
  loadCommandCheckpoint,
  clearCommandCheckpoint,
  getCheckpointPath,
} from '../../utils/checkpoint';

export const generateCommand = new Command('generate')
  .description('Generate synthetic data using Faker or LLM')
  .addOption(
    new Option(
      '-t, --type <type>',
      'Data type (person, address, company, product, text, lorem, llm, all)'
    )
      .choices(['person', 'address', 'company', 'product', 'text', 'lorem', 'llm', 'all'])
      .default('person')
  )
  .option('-c, --count <number>', 'Number of records to generate', '10')
  .option('-l, --locale <locale>', 'Locale for Faker (en, de, es, fr, etc.)', 'en')
  .option('-o, --output <file>', 'Output file path')
  .addOption(
    new Option('-f, --format <format>', 'Output format (json, jsonl, csv)')
      .choices(['json', 'jsonl', 'csv'])
      .default('json')
  )
  // LLM-specific options
  .option('-p, --prompt <prompt>', 'Prompt for LLM generation')
  .option('-m, --model <model>', 'Ollama model to use')
  .option('-s, --schema <schema>', 'JSON schema file for structured output')
  .option(
    '-a, --auto-schema <description>',
    'Auto-generate schema from description (e.g., "product with name, price, description")'
  )
  .option('-w, --web-search <query>', 'Search query to inject web context into the LLM prompt')
  .option('--resume <checkpoint-file>', 'Resume from a saved checkpoint file')
  .action(
    wrapAction('generate', async (options) => {
      let type = options.type;

      // Handle --dry-run
      if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
        const isLlm = type === 'llm' || options.prompt || options.autoSchema;
        const planned_actions: string[] = [];
        if (isLlm) {
          planned_actions.push(`Generate ${options.count} records using LLM`);
          planned_actions.push(`Model: ${options.model || 'default'}`);
          if (options.prompt) planned_actions.push(`Prompt: ${options.prompt}`);
          if (options.autoSchema) planned_actions.push(`Auto-schema: ${options.autoSchema}`);
          if (options.webSearch) planned_actions.push(`Web search context: ${options.webSearch}`);
        } else {
          planned_actions.push(`Generate ${options.count} ${type} records using Faker`);
          planned_actions.push(`Locale: ${options.locale}`);
        }
        planned_actions.push(`Output format: ${options.format}`);
        if (options.output) planned_actions.push(`Output file: ${options.output}`);

        outputResult('generate', {
          dry_run: true,
          command: 'generate',
          planned_actions,
          estimated: {
            records: parseInt(options.count, 10),
            type: isLlm ? 'llm' : type,
            model: isLlm ? options.model || 'default' : undefined,
          },
        });
        if (!isJsonMode()) {
          console.log(chalk.yellow('Dry run - no data will be generated.'));
          for (const action of planned_actions) {
            console.log(chalk.gray(`  - ${action}`));
          }
        }
        return;
      }

      // Auto-detect LLM mode if prompt or auto-schema is provided
      if ((options.prompt || options.autoSchema) && type !== 'llm') {
        if (process.env.VERBOSE === 'true') {
          if (!isJsonMode()) {
            console.log(chalk.gray('[verbose] Prompt/auto-schema detected, switching to LLM mode'));
          }
        }
        type = 'llm';
      }

      // Handle LLM generation
      if (type === 'llm') {
        if (!options.prompt) {
          if (!isJsonMode()) {
            console.error(chalk.red('Error: --prompt is required for llm type'));
          }
          exitWithCode(ExitCode.INVALID_INPUT, '--prompt is required for llm type');
        }

        // Create task structure for this generation
        const taskId = generateTaskId();
        const config = getConfig();
        const baseOutputDir = config.get('outputDir') || './output';

        if (!isJsonMode()) {
          console.log(chalk.blue('Generating with LLM...'));
          console.log(chalk.gray(`Task ID: ${taskId}`));
          console.log(chalk.gray(`Prompt: ${options.prompt}`));
          console.log(chalk.gray(`Model: ${options.model || 'default'}`));
          console.log(chalk.gray(`Count: ${options.count}`));
        }

        try {
          // Create task folder structure
          await createTaskStructure(
            taskId,
            ['scraped', 'downloads', 'images', 'generated', 'cleaned'],
            baseOutputDir
          );
          await createTaskMetadata(
            taskId,
            `generate --type llm --prompt "${options.prompt}" --count ${options.count}`,
            baseOutputDir,
            { model: options.model || 'default', format: options.format },
            'generate'
          );

          const ollama = getOllama();
          const isOnline = await ollama.ping();

          if (!isOnline) {
            if (!isJsonMode()) {
              console.error(chalk.red('Error: Ollama is not running. Start Ollama and try again.'));
            }
            await updateTaskStatus(taskId, 'failed', baseOutputDir);
            exitWithCode(
              ExitCode.OLLAMA_UNAVAILABLE,
              'Ollama is not running. Start Ollama and try again.'
            );
          }

          // Handle web search enhancement
          let enhancedPrompt = options.prompt;
          if (options.webSearch) {
            if (!isJsonMode()) {
              console.log(chalk.blue('Performing web search...'));
              console.log(chalk.gray(`Search query: ${options.webSearch}`));
            }
            try {
              const searchResults = await webSearch(options.webSearch);
              const searchContext = formatSearchResultsAsContext(searchResults);
              enhancedPrompt = options.prompt + searchContext;
              if (!isJsonMode()) {
                console.log(chalk.green(`Retrieved ${searchResults.length} search results`));
              }
            } catch (error: any) {
              if (!isJsonMode()) {
                console.error(chalk.red('Web search failed:'), error.message);
              }
              await updateTaskStatus(taskId, 'failed', baseOutputDir);
              exitWithCode(ExitCode.NETWORK_ERROR, `Web search failed: ${error.message}`);
            }
          }

          let data: any[];
          let schema: object | undefined;
          let metrics: GenerationMetrics | undefined;

          // Handle auto-schema generation
          if (options.autoSchema) {
            if (!isJsonMode()) {
              console.log(chalk.gray(`Auto-generating schema for: "${options.autoSchema}"...`));
            }
            try {
              schema = await generateSchemaFromDescription(options.autoSchema, options.model);
              if (!isJsonMode()) {
                console.log(chalk.gray('Generated schema:'));
                console.log(chalk.gray(JSON.stringify(schema, null, 2)));
              }
            } catch (error: any) {
              if (!isJsonMode()) {
                console.error(chalk.red('Failed to auto-generate schema:'), error.message);
              }
              await updateTaskStatus(taskId, 'failed', baseOutputDir);
              exitWithCode(
                ExitCode.OLLAMA_UNAVAILABLE,
                `Failed to auto-generate schema: ${error.message}`
              );
            }
          } else if (options.schema) {
            // Read schema from file
            const schemaContent = await fs.readFile(options.schema, 'utf-8');
            schema = safeJsonParse(schemaContent, 'schema file') as object;
          }

          // Determine output path
          let outputPath: string;
          if (options.output) {
            outputPath = path.resolve(options.output);
          } else {
            // Use task folder for output
            const ext =
              options.format === 'jsonl' ? 'jsonl' : options.format === 'csv' ? 'csv' : 'json';
            outputPath = getTaskFilePath(taskId, 'generated', `output.${ext}`, baseOutputDir);
          }

          // ── Resume from checkpoint if requested ──
          let resumedData: unknown[] = [];
          const completedSet = new Set<number>();
          if (options.resume) {
            const cp = await loadCommandCheckpoint(path.resolve(options.resume));
            if (cp && cp.command === 'generate') {
              resumedData = cp.partialResults as unknown[];
              for (const idx of cp.completedIndices) completedSet.add(idx);
              if (!isJsonMode()) {
                console.log(
                  chalk.green(
                    `Resuming from checkpoint – ${resumedData.length} records already completed`
                  )
                );
              }
            } else {
              if (!isJsonMode()) {
                console.warn(
                  chalk.yellow('Checkpoint file not found or incompatible – starting fresh')
                );
              }
            }
          }

          if (schema) {
            // Structured generation with TUI
            const count = parseInt(options.count, 10);

            // Set up abort handler with checkpoint save
            let abortRequested = false;
            const abortHandler = async () => {
              abortRequested = true;
              if (!isJsonMode()) {
                console.log(chalk.yellow('\nAbort requested... saving checkpoint'));
              }
              const cp: CommandCheckpoint = {
                command: 'generate',
                outputPath,
                totalRecords: count,
                completedIndices: [...completedSet],
                partialResults: [...resumedData, ...data],
                startedAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString(),
                meta: { schema: true, model: options.model, prompt: enhancedPrompt },
              };
              await saveCommandCheckpoint(cp);
              if (!isJsonMode()) {
                console.log(chalk.green(`Checkpoint saved: ${getCheckpointPath(outputPath)}`));
              }
            };
            process.on('SIGINT', abortHandler);

            createGenerateTUI(count);
            const startTime = Date.now();

            try {
              const batchResult = await generateStructuredBatch(
                {
                  prompt: enhancedPrompt,
                  schema,
                  model: options.model,
                },
                count,
                (progress: GenerationProgress) => {
                  if (!abortRequested) {
                    updateGenerateProgress(progress);
                  }
                }
              );

              data = batchResult.results.map((r) => r.data).filter((d) => d !== null);
              metrics = batchResult.metrics;
            } finally {
              stopGenerateTUI();
              process.off('SIGINT', abortHandler);
            }

            // Merge resumed data
            data = [...resumedData, ...data];
          } else {
            // Simple LLM generation with TUI
            const count = parseInt(options.count, 10);
            data = [...resumedData];

            // Set up abort handler with checkpoint save
            let abortRequested = false;
            const abortHandler = async () => {
              abortRequested = true;
              if (!isJsonMode()) {
                console.log(chalk.yellow('\nAbort requested... saving checkpoint'));
              }
              const cp: CommandCheckpoint = {
                command: 'generate',
                outputPath,
                totalRecords: count,
                completedIndices: [...completedSet],
                partialResults: data,
                startedAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString(),
                meta: { schema: false, model: options.model, prompt: enhancedPrompt },
              };
              await saveCommandCheckpoint(cp);
              if (!isJsonMode()) {
                console.log(chalk.green(`Checkpoint saved: ${getCheckpointPath(outputPath)}`));
              }
            };
            process.on('SIGINT', abortHandler);

            createGenerateTUI(count);
            const startTime = Date.now();
            const recordTimes: number[] = [];

            try {
              for (let i = 0; i < count; i++) {
                if (abortRequested) {
                  break;
                }

                // Skip already-completed indices when resuming
                if (completedSet.has(i)) {
                  continue;
                }

                const recordStartTime = Date.now();

                // Update progress before generation
                updateGenerateProgress({
                  current: data.length,
                  total: count,
                  status: 'generating',
                  startTime,
                  estimatedTimeRemaining: calculateSimpleETA(recordTimes, count, data.length),
                });

                const response = await ollama.generate({
                  model: options.model,
                  prompt: enhancedPrompt,
                });

                recordTimes.push(Date.now() - recordStartTime);
                data.push({ text: response.response, index: i });
                completedSet.add(i);

                // Update progress after generation
                updateGenerateProgress({
                  current: data.length,
                  total: count,
                  status: 'completed',
                  startTime,
                  estimatedTimeRemaining: calculateSimpleETA(recordTimes, count, data.length),
                });
              }
            } finally {
              stopGenerateTUI();
              process.off('SIGINT', abortHandler);
            }
          }

          const outputContent = formatOutput(data, options.format as string);

          // Ensure output directory exists
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, outputContent, 'utf-8');

          // Clear checkpoint on successful completion
          await clearCommandCheckpoint(outputPath);

          // Display comprehensive summary
          displayGenerationSummary(
            data.length,
            parseInt(options.count, 10),
            metrics,
            outputPath,
            taskId
          );

          // Update task status
          await updateTaskStatus(taskId, 'completed', baseOutputDir);

          outputResult('generate', {
            type: 'llm',
            records: data.length,
            target: parseInt(options.count, 10),
            outputFile: outputPath,
            taskId,
          });
        } catch (error) {
          if (!isJsonMode()) {
            console.error(chalk.red('Error:'), error);
          }
          await updateTaskStatus(taskId, 'failed', baseOutputDir);
          const message = error instanceof Error ? error.message : String(error);
          // Classify: Ollama connectivity vs other errors
          if (
            message.includes('ECONNREFUSED') ||
            message.includes('ETIMEDOUT') ||
            message.includes('fetch failed')
          ) {
            exitWithCode(ExitCode.OLLAMA_UNAVAILABLE, message);
          } else if (error instanceof Error && 'exitCode' in error) {
            exitWithCode((error as any).exitCode, message);
          } else {
            exitWithCode(ExitCode.GENERAL_ERROR, message);
          }
        }
        return;
      }

      // Handle Faker generation (original behavior)
      if (!isJsonMode()) {
        console.log(chalk.blue('Generating synthetic data...'));
        console.log(chalk.gray(`Type: ${options.type}`));
        console.log(chalk.gray(`Count: ${options.count}`));
        console.log(chalk.gray(`Locale: ${options.locale}`));
      }

      try {
        const count = parseInt(options.count, 10);
        const data = generateSyntheticData(options.type as string, count, options.locale as string);

        const outputContent = formatOutput(data, options.format as string);

        if (options.output) {
          const outputPath = path.resolve(options.output);
          await fs.writeFile(outputPath, outputContent, 'utf-8');
          if (!isJsonMode()) {
            console.log(chalk.green(`Data written to: ${outputPath}`));
          }
        } else if (!isJsonMode()) {
          console.log(chalk.gray('\nGenerated data:'));
          console.log(outputContent);
        }

        if (!isJsonMode()) {
          console.log(chalk.green(`Generated ${count} records successfully!`));
        }

        outputResult('generate', {
          type: options.type,
          records: count,
          outputFile: options.output || null,
        });
      } catch (error) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error:'), error);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Unsupported') || message.includes('Invalid')) {
          exitWithCode(ExitCode.INVALID_INPUT, message);
        } else {
          exitWithCode(ExitCode.GENERAL_ERROR, message);
        }
      }
    })
  );

function formatOutput(data: unknown[], format: string): string {
  switch (format) {
    case 'jsonl':
      return data.map((item) => JSON.stringify(item)).join('\n');
    case 'csv':
      if (data.length === 0) return '';
      const headers = Object.keys(data[0] as object);
      const rows = data.map((item) =>
        headers
          .map((h) => {
            const val = (item as Record<string, unknown>)[h];
            const str = String(val ?? '');
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    case 'json':
    default:
      return JSON.stringify(data, null, 2);
  }
}

/**
 * Display comprehensive generation summary
 */
function displayGenerationSummary(
  successCount: number,
  targetCount: number,
  metrics: GenerationMetrics | undefined,
  outputPath: string,
  taskId: string
): void {
  if (isJsonMode()) return;

  const failedCount = targetCount - successCount;
  const successRate = targetCount > 0 ? ((successCount / targetCount) * 100).toFixed(1) : '0.0';

  console.log('\n' + chalk.bold('='.repeat(60)));
  console.log(chalk.bold('📊 Generation Summary'));
  console.log(chalk.bold('='.repeat(60)));

  // Count section
  console.log(chalk.blue('\n📈 Counts:'));
  console.log(`  Target:     ${chalk.cyan(targetCount.toString())}`);
  console.log(`  Generated:  ${chalk.green(successCount.toString())}`);
  console.log(
    `  Failed:     ${failedCount > 0 ? chalk.red(failedCount.toString()) : chalk.gray('0')}`
  );
  console.log(`  Success Rate: ${chalk.green(`${successRate}%`)}`);

  // Metrics section (if available)
  if (metrics) {
    console.log(chalk.blue('\n⏱️  Timing:'));
    console.log(
      `  Total Duration:     ${chalk.cyan(`${(metrics.totalDuration / 1000).toFixed(2)}s`)}`
    );
    console.log(
      `  Average Response:   ${chalk.cyan(`${(metrics.averageResponseTime / 1000).toFixed(2)}s`)}`
    );

    // Repair stats
    if (metrics.repairAttempts > 0) {
      console.log(chalk.blue('\n🔧 JSON Repairs:'));
      console.log(`  Attempts:  ${chalk.yellow(metrics.repairAttempts.toString())}`);
      console.log(`  Successes: ${chalk.green(metrics.repairSuccesses.toString())}`);
      console.log(
        `  Rate:      ${chalk.cyan(`${((metrics.repairSuccesses / metrics.repairAttempts) * 100).toFixed(1)}%`)}`
      );
    }

    // Error breakdown
    const errorTypes = Object.entries(metrics.errorsByType);
    if (errorTypes.length > 0) {
      console.log(chalk.blue('\n⚠️  Error Breakdown:'));
      for (const [type, count] of errorTypes) {
        console.log(`  ${type}: ${chalk.red(count.toString())}`);
      }
    }
  }

  // Output section
  console.log(chalk.blue('\n📁 Output:'));
  console.log(`  Task ID: ${chalk.cyan(taskId)}`);
  console.log(`  File:    ${chalk.cyan(outputPath)}`);

  console.log('\n' + chalk.bold('='.repeat(60)));

  // Final status
  if (successCount === targetCount) {
    console.log(chalk.green('✅ All records generated successfully!'));
  } else if (successCount > 0) {
    console.log(
      chalk.yellow(`⚠️  Partial success: ${successCount}/${targetCount} records generated`)
    );
  } else {
    console.log(chalk.red('❌ Generation failed: No records were created'));
  }
}

/** Calculate ETA for simple LLM generation based on record times */
function calculateSimpleETA(recordTimes: number[], total: number, current: number): number {
  if (recordTimes.length === 0 || current >= total) {
    return 0;
  }
  const avgTime = recordTimes.reduce((a, b) => a + b, 0) / recordTimes.length;
  const remaining = total - current;
  return avgTime * remaining;
}
