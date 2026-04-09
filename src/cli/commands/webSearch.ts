import { Command } from 'commander';
import chalk from 'chalk';
import { webSearch, WebSearchResult } from '../../generators/webSearch';
import { outputResult, isJsonMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { getConfig } from '../../config';
import fs from 'fs/promises';
import path from 'path';
import { ProgressSpinner } from '../../utils/tui';

export const webSearchCommand = new Command('web-search')
  .description("Search the web using Ollama's web search API")
  .option('-q, --query <query>', 'Search query (required)')
  .option('-n, --max-results <number>', 'Maximum results to return (default: 5, max: 10)')
  .option('-o, --output <file>', 'Output file (optional, prints to console if not specified)')
  .option('-f, --format <format>', 'Output format (json, jsonl, csv)', 'json')
  .action(
    wrapAction('web-search', async (options) => {
      if (!options.query) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: --query is required'));
          console.log(chalk.yellow('Example: npm start -- web-search --query "AI news"'));
        }
        exitWithCode(ExitCode.INVALID_INPUT, '--query is required');
      }

      const config = getConfig();

      // Check if API key is available
      const apiKey = process.env.OLLAMA_API_KEY || config.get('ollamaApiKey');
      if (!apiKey) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: Ollama API key required'));
          console.log(chalk.yellow('Set OLLAMA_API_KEY env var or run:'));
          console.log(chalk.cyan('  npm start -- config set ollamaApiKey <key>'));
        }
        exitWithCode(ExitCode.MISSING_DEPENDENCY, 'Ollama API key required');
      }

      const maxResults = options.maxResults
        ? parseInt(options.maxResults, 10)
        : config.get('webSearchMaxResults') || 5;

      if (!isJsonMode()) {
        console.log(chalk.gray(`Query: ${options.query}`));
        console.log(chalk.gray(`Max results: ${maxResults}`));
      }

      const spinner = new ProgressSpinner('Searching the web...');
      spinner.start();

      try {
        const results = await webSearch(options.query, maxResults);
        spinner.stop(results.length > 0);

        if (results.length === 0) {
          if (!isJsonMode()) {
            console.log(chalk.yellow('No results found'));
          }
          outputResult('web-search', { results: [], query: options.query });
          return;
        }

        if (!isJsonMode()) {
          console.log(chalk.green(`Found ${results.length} results`));
        }

        if (options.output) {
          // Write to file in requested format
          const output = formatOutput(results, options.format as string);
          const outputPath = path.resolve(options.output);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, output, 'utf-8');
          if (!isJsonMode()) {
            console.log(chalk.green(`Results written to: ${outputPath}`));
          }
        } else if (!isJsonMode()) {
          // Display formatted results to console
          console.log(chalk.gray(`\nSearch Results (${results.length} found):\n`));
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            console.log(chalk.cyan(`${i + 1}. ${r.title}`));
            console.log(chalk.gray(`   URL: ${r.url}`));
            if (r.content) {
              const preview = r.content.length > 120 ? r.content.slice(0, 120) + '...' : r.content;
              console.log(chalk.gray(`   ${preview}`));
            }
            if (i < results.length - 1) console.log();
          }
        }
        outputResult('web-search', {
          query: options.query,
          results: results.length,
          outputFile: options.output || null,
        });
      } catch (error: any) {
        spinner.stop(false);
        if (!isJsonMode()) {
          console.error(chalk.red('Error:'), error.message);
        }
        exitWithCode(ExitCode.NETWORK_ERROR, error.message);
      }
    })
  );

function formatOutput(results: WebSearchResult[], format: string): string {
  switch (format) {
    case 'jsonl':
      return results.map((item) => JSON.stringify(item)).join('\n');
    case 'csv':
      if (results.length === 0) return '';
      const headers = ['title', 'url', 'content'];
      const rows = results.map((item) => {
        return headers
          .map((h) => {
            const val = item[h as keyof WebSearchResult];
            const str = String(val ?? '');
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          })
          .join(',');
      });
      return [headers.join(','), ...rows].join('\n');
    case 'json':
    default:
      return JSON.stringify(results, null, 2);
  }
}
