import { Command, Option } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { spawnSync } from 'child_process';
import { runScrapy } from '../../scrapy/runner';
import { search } from '../../scrapy/autoSearch';
import type { SearchResult } from '../../scrapy/search/types';
import { ensureProviders, listProviders as listAllProviders } from '../../scrapy/search/registry';
import { listPresets, resolvePreset } from '../../scrapy/search/presets';
import { downloadMultiple, DownloadItem, DownloadProgress, Downloader } from '../../downloader';
import { AssetManifest, AssetRecord } from '../../downloader/types';
import { createEmptyManifest, extractTags } from '../../downloader/manifest-utils';
import { getConfig } from '../../config';
import { verboseLog } from '../../utils/logger';
import { DetailedLogger, formatTaskStartTime } from '../../utils/detailedLogger';
import { generateTaskId } from '../../utils/taskManager';
import {
  isYouTubeUrl,
  isYouTubePlaylist,
  getPlaylistInfo,
  buildYouTubeVideoUrl,
} from '../../downloader/videoHandler';
import { showDownloadSummary } from '../../utils/downloadSummary';
import { validateSearchResults, ValidateMethod } from '../../scrapy/searchValidator';
import { ProgressSpinner, ProgressTracker } from '../../utils/tui';
import type { ConfigLoader } from '../../config/loader';

/** Typed options for the scrape command */
interface ScrapeOptions {
  url?: string;
  spider: string;
  output: string;
  outputFormat?: string;
  depth: string;
  engine: string;
  settings?: string;
  search?: string;
  searchProvider?: string;
  sourcePreset?: string;
  listPresets: boolean;
  listProviders: boolean;
  searchCount: string;
  searchApiKey?: string;
  searchEngineId?: string;
  download: boolean;
  verbose: boolean;
  formats?: string;
  concurrent?: number;
  ytConcurrent: string;
  timeout: string;
  ytQuality?: string;
  ytAudioOnly: boolean;
  ytVideoOnly: boolean;
  ytCookies?: string;
  searchLocation?: string;
  validateSearch: boolean;
  validateMethod?: string;
  validateThreshold?: string;
  yes: boolean;
  noEstimate: boolean;
  retry?: string;
}

/**
 * Clean a snippet string: strip markers, markdown links, HTML entities, and collapse whitespace.
 * Exported for testing.
 */
export function cleanSnippet(raw: string): string {
  let s = raw;
  // Strip [web_link] / [image_link] markers
  s = s.replace(/\[(web|image)_link\]/g, '');
  // Strip markdown image links: [![alt](img)](url)
  s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  // Strip bare markdown images: ![alt](url) — must come BEFORE [text](url)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Strip markdown links: [text](url) keeping the text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Decode common HTML entities
  s = s.replace(/&#8217;/g, "'").replace(/&#8216;/g, "'");
  s = s.replace(/&#8220;/g, '"').replace(/&#8221;/g, '"');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Format search results for clean console display
 * - Strips markers, markdown links, HTML entities from snippets
 * - Truncates snippets to 150 chars
 * - Shows numbered list with URL and single-line snippet
 */
function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return chalk.gray('Search Results (0 found):\n');
  }

  const MAX_SNIPPET = 150;
  const lines: string[] = [];
  lines.push(chalk.gray(`Search Results (${results.length} found):\n`));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];

    // Strip markers from title
    const cleanTitle = r.title.replace(/\[(web|image)_link\]/g, '').trim();
    // Clean and truncate snippet
    const snippet = r.snippet ? cleanSnippet(r.snippet) : '';
    const truncated =
      snippet.length > MAX_SNIPPET ? snippet.slice(0, MAX_SNIPPET) + '...' : snippet;

    // Title with number and provider tag
    const providerTag = r.provider ? chalk.magenta(` [${r.provider}]`) : '';
    lines.push(chalk.cyan(`${i + 1}. ${cleanTitle}`) + providerTag);

    // URL
    lines.push(chalk.gray(`   URL: ${r.url}`));

    // Single-line truncated snippet
    if (truncated) {
      lines.push(chalk.gray(`   ${truncated}`));
    }

    // Blank line between entries (except after last)
    if (i < results.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

export const scrapeCommand = new Command('scrape')
  .description('Scrape websites using Scrapy with auto-search and download capabilities')
  .option('-u, --url <url>', 'Target URL to scrape')
  .option('-s, --spider <name>', 'Spider name to use', 'basic')
  .option(
    '-o, --output <format>',
    'Output format (json, jsonl, csv, xml) [deprecated: use --output-format]',
    'json'
  )
  .addOption(
    new Option('--output-format <format>', 'Output format (json, jsonl, csv, xml)').choices([
      'json',
      'jsonl',
      'csv',
      'xml',
    ])
  )
  .option('-d, --depth <number>', 'Scraping depth', '1')
  .option('-e, --engine <name>', 'Scraping engine to use', 'scrapy')
  .option('--settings <file>', 'Custom Scrapy settings file')
  // Auto-search options
  .option('--search <query>', 'Search query to find URLs to scrape')
  .option(
    '--search-provider <provider>',
    'Search provider(s), comma-separated (e.g. google,bing,brave). Supports: google, bing, duckduckgo, brave, ollama, youtube, reddit, arxiv, google-scholar, semantic-scholar, sketchfab, google-images, bing-images, github, twitter, facebook, instagram'
  )
  .addOption(
    new Option(
      '--source-preset <preset>',
      'Use a source preset (web, images, videos, academic, code, 3d-assets, social)'
    ).choices(['web', 'images', 'videos', 'academic', 'code', '3d-assets', 'social'])
  )
  .option('--list-presets', 'List available source presets')
  .option('--list-providers', 'List all registered search providers')
  .option('--search-count <number>', 'Number of results per search provider', '10')
  // API key options (can also be set via config)
  .option('--search-api-key <key>', 'API key for search provider (overrides config)')
  .option('--search-engine-id <id>', 'Search engine ID (required for Google Custom Search)')
  // Download options
  .option('--download', 'Download files from scraped URLs', false)
  // Verbose option (inherited from global but needs explicit mention for help)
  .option('--verbose', 'Enable verbose output (show detailed search debugging)')
  .option(
    '--formats <formats>',
    'Comma-separated formats to download (image,video,pdf,pptx,docx,csv)'
  )
  .option('-c, --concurrent <number>', 'Max concurrent downloads')
  .option('--yt-concurrent <number>', 'Max concurrent YouTube downloads (default: 1)')
  .option('-t, --timeout <number>', 'Download timeout in milliseconds (default: 15000)', '15000')
  .addOption(
    new Option(
      '--yt-quality <resolution>',
      'YouTube video quality (e.g., 720, 1080, best)'
    ).choices(['360', '480', '720', '1080', '1440', '2160', 'best'])
  )
  .option('--yt-audio-only', 'Download YouTube audio only (MP3)', false)
  .option('--yt-video-only', 'Download YouTube video only (no audio)', false)
  .option(
    '--yt-cookies [path]',
    'Path to cookies.txt file for YouTube auth (default: .temp/www.youtube.com_cookies.txt)'
  )
  .option(
    '--search-location <location>',
    'Location for geo-targeted results (e.g., "New York,New York,United States")'
  )
  .option('--validate-search', 'Validate search results for relevance before scraping', false)
  .addOption(
    new Option(
      '--validate-method <method>',
      'Validation method: deterministic or llm (default: deterministic)'
    ).choices(['deterministic', 'llm'])
  )
  .option(
    '--validate-threshold <number>',
    'Relevance threshold 0.0-1.0 (default: 0.3 for deterministic, 0.5 for llm)'
  )
  .option('-y, --yes', 'Skip download confirmation prompt', false)
  .option('--no-estimate', 'Skip download size estimation')
  .option('--retry <count>', 'Number of download retries (default: 0, no retries)')
  .action(
    wrapAction('scrape', async (options) => {
      // Handle --dry-run early
      if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
        const planned_actions: string[] = [];
        if (options.search) {
          planned_actions.push(`Search for: "${options.search}"`);
          planned_actions.push(
            `Provider: ${options.searchProvider || options.sourcePreset || 'auto-detect'}`
          );
          planned_actions.push(`Results per provider: ${options.searchCount}`);
          if (options.download) {
            planned_actions.push(`Download media matching: ${options.formats || 'image,pdf'}`);
          }
        } else if (options.url) {
          planned_actions.push(`Scrape URL: ${options.url}`);
          planned_actions.push(`Spider: ${options.spider}`);
          planned_actions.push(`Depth: ${options.depth}`);
        } else {
          planned_actions.push('No --url or --search specified');
        }
        planned_actions.push(`Output format: ${options.outputFormat || options.output || 'json'}`);

        outputResult('scrape', {
          dry_run: true,
          command: 'scrape',
          planned_actions,
          estimated: {
            records: options.search ? parseInt(options.searchCount, 10) : undefined,
          },
        });
        if (!isJsonMode()) {
          console.log(chalk.yellow('Dry run - no scraping will be performed.'));
          for (const action of planned_actions) {
            console.log(chalk.gray(`  - ${action}`));
          }
        }
        return;
      }

      // Resolve --output-format as canonical, with -o/--output as deprecated fallback
      if (options.outputFormat) {
        options.output = options.outputFormat;
      } else if (options.output && options.output !== 'json') {
        // User explicitly passed -o with a non-default value — show deprecation warning
        if (!isJsonMode()) {
          console.warn(
            chalk.yellow(
              'Warning: -o/--output for format is deprecated. Use --output-format instead.'
            )
          );
        }
      }

      const config = getConfig();

      // Handle --list-presets
      if (options.listPresets) {
        await ensureProviders();
        const presets = listPresets();
        if (isJsonMode()) {
          outputResult('scrape', {
            presets: presets.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              providers: p.providers,
            })),
          });
          return;
        }
        if (!isJsonMode()) {
          console.log(chalk.bold('\nAvailable Source Presets:\n'));
          for (const preset of presets) {
            console.log(chalk.cyan(`  ${preset.id.padEnd(12)} `) + chalk.white(preset.name));
            console.log(chalk.gray(`${''.padEnd(14)} ${preset.description}`));
            console.log(chalk.gray(`${''.padEnd(14)} Providers: ${preset.providers.join(', ')}`));
            console.log();
          }
        }
        return;
      }

      // Handle --list-providers
      if (options.listProviders) {
        await ensureProviders();
        const providers = listAllProviders();
        if (isJsonMode()) {
          outputResult('scrape', {
            providers: providers.map((p) => ({
              id: p.config.id,
              name: p.config.name,
              category: p.config.category,
              available: p.isAvailable(),
              requiresApiKey: p.config.requiresApiKey,
            })),
          });
          return;
        }
        if (!isJsonMode()) {
          console.log(chalk.bold('\nRegistered Search Providers:\n'));
          for (const provider of providers) {
            const available = provider.isAvailable();
            const status = available ? chalk.green('available') : chalk.red('unavailable');
            const apiKey = provider.config.requiresApiKey
              ? chalk.yellow(` (API key: ${provider.config.apiKeyConfigName || 'required'})`)
              : chalk.gray(' (no API key needed)');
            console.log(
              chalk.cyan(`  ${provider.config.id.padEnd(20)} `) +
                chalk.white(provider.config.name.padEnd(20)) +
                chalk.gray(`[${provider.config.category}]`.padEnd(14)) +
                status +
                apiKey
            );
          }
          console.log();
        }
        return;
      }

      // Handle auto-search
      if (options.search) {
        await handleAutoSearch(options, config);
        return;
      }

      // Handle regular scraping
      if (!options.url) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: Either --url or --search is required'));
        }
        exitWithCode(ExitCode.INVALID_INPUT, 'Either --url or --search is required');
      }

      // Generate task ID and display task info at start
      const taskId = generateTaskId();
      const outputDir = config.get('outputDir') || './output';
      const taskDir = path.join(outputDir, taskId);

      // Display task info header
      if (!isJsonMode()) {
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.bold('  Task ID:'), chalk.yellow(taskId));
        console.log(chalk.bold('  Started:'), formatTaskStartTime());
        console.log(chalk.bold('  Operation:'), 'Direct URL scrape');
        console.log(chalk.bold('  URL:'), options.url);
        console.log(chalk.bold('  Output:'), taskDir);
        console.log(chalk.cyan('═'.repeat(60)));
        console.log();

        console.log(chalk.blue('Starting scrape...'));
        console.log(chalk.gray(`URL: ${options.url}`));
        console.log(chalk.gray(`Spider: ${options.spider}`));
        console.log(chalk.gray(`Output: ${options.output}`));
      }

      try {
        const result = await runScrapy({
          url: options.url,
          spider: options.spider,
          output: options.output,
          depth: parseInt(options.depth, 10),
          settings: options.settings,
          engine: options.engine,
        });

        if (result.success) {
          if (!isJsonMode()) {
            console.log(chalk.green('Scrape completed successfully!'));
            console.log(chalk.gray(`Output file: ${result.outputFile}`));
          }

          outputResult('scrape', {
            outputFile: result.outputFile,
            url: options.url,
          });

          // Handle downloads if requested
          if (options.download && result.outputFile) {
            const taskId = generateTaskId();
            const outputDir = config.get('outputDir') || './output';
            const taskDir = path.join(outputDir, taskId);
            const logger = new DetailedLogger({ taskDir, taskId, verbose: options.verbose });
            await logger.initialize();
            await handleDownloads(result.outputFile, options, config, taskId, taskDir, logger);
          }
        } else {
          if (!isJsonMode()) {
            console.error(chalk.red('Scrape failed:'), result.error);
          }
          const errMsg = result.error || 'Scrape failed';
          if (
            errMsg.includes('ECONNREFUSED') ||
            errMsg.includes('ETIMEDOUT') ||
            errMsg.includes('DNS')
          ) {
            exitWithCode(ExitCode.NETWORK_ERROR, errMsg);
          } else {
            exitWithCode(ExitCode.GENERAL_ERROR, errMsg);
          }
        }
      } catch (error) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error:'), error);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('ECONNREFUSED') ||
          message.includes('ETIMEDOUT') ||
          message.includes('DNS')
        ) {
          exitWithCode(ExitCode.NETWORK_ERROR, message);
        } else {
          exitWithCode(ExitCode.GENERAL_ERROR, message);
        }
      }
    })
  );

/** Handle auto-search functionality */
async function handleAutoSearch(options: ScrapeOptions, config: ConfigLoader): Promise<void> {
  // Generate task ID early and display task info
  const taskId = generateTaskId();
  const startTime = new Date();
  const baseOutputDir = config.get('outputDir') || './output';
  const taskDir = path.join(baseOutputDir, taskId);

  // Display task info header
  if (!isJsonMode()) {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  Task ID:'), chalk.yellow(taskId));
    console.log(chalk.bold('  Started:'), formatTaskStartTime(startTime));
    console.log(chalk.bold('  Output:'), taskDir);
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
  }

  // Initialize detailed logger
  const logger = new DetailedLogger({ taskDir, taskId, verbose: options.verbose });
  await logger.initialize();

  if (!isJsonMode()) {
    console.log(chalk.gray(`Query: ${options.search}`));
    console.log(chalk.gray(`Provider: ${options.searchProvider || 'auto-detect'}`));
    console.log(chalk.gray(`Count per provider: ${options.searchCount}`));
  }

  logger.info('Auto-search started', 'search', {
    query: options.search,
    provider: options.searchProvider,
    count: parseInt(options.searchCount, 10),
  });

  try {
    // Set API key from command line if provided
    if (options.searchApiKey) {
      const provider = options.searchProvider;
      if (provider === 'google') {
        config.set('googleApiKey', options.searchApiKey);
        if (options.searchEngineId) {
          config.set('googleSearchEngineId', options.searchEngineId);
        }
      } else if (provider === 'bing') {
        config.set('bingApiKey', options.searchApiKey);
      } else if (provider === 'brave') {
        config.set('braveApiKey', options.searchApiKey);
      }
    }

    // Set search location if provided
    if (options.searchLocation) {
      config.set('searchLocation', options.searchLocation);
    }

    // Determine search provider(s): --source-preset > --search-provider > config searchProviders > config searchProvider > auto-detect
    let provider: string;

    if (options.sourcePreset) {
      const presetProviders = resolvePreset(options.sourcePreset);
      if (!presetProviders) {
        if (!isJsonMode()) {
          console.error(
            chalk.red(
              `Unknown source preset: "${options.sourcePreset}". Use --list-presets to see available presets.`
            )
          );
        }
        return;
      }
      provider = presetProviders.join(',');
      verboseLog(`Resolved preset "${options.sourcePreset}" to providers: ${provider}`);
    } else if (options.searchProvider) {
      provider = options.searchProvider;
    } else if (config.get('searchProviders')) {
      provider = config.get('searchProviders') as string;
    } else if (config.get('searchProvider')) {
      provider = config.get('searchProvider') as string;
    } else {
      // Auto-detect based on available API keys
      if (config.get('braveApiKey')) provider = 'brave';
      else if (config.get('bingApiKey')) provider = 'bing';
      else if (config.get('googleApiKey') && config.get('googleSearchEngineId'))
        provider = 'google';
      else if (config.get('ollamaApiKey')) provider = 'ollama';
      else provider = 'duckduckgo';
    }

    verboseLog(`Using search provider(s): ${provider}`);

    const providerDisplay =
      provider.includes(',') || provider.includes(' ') ? `multi: ${provider}` : provider;
    const searchSpinner = new ProgressSpinner(`Searching for URLs (${providerDisplay})...`);
    searchSpinner.start();

    const searchResult = await search(options.search!, parseInt(options.searchCount, 10), provider);
    const { results, totalBefore, duplicatesRemoved } = searchResult;

    searchSpinner.stop(results.length > 0);

    // Dedup report
    if (duplicatesRemoved > 0 && !isJsonMode()) {
      console.log(
        chalk.green(
          `Found ${totalBefore} results → ${results.length} unique (${duplicatesRemoved} duplicates removed)`
        )
      );
    }

    let validatedResults = results;

    // Validate search results if requested
    if (options.validateSearch && results.length > 0) {
      const method: ValidateMethod = (options.validateMethod as ValidateMethod) || 'deterministic';
      const defaultThreshold = method === 'llm' ? 0.5 : 0.3;
      const threshold = options.validateThreshold
        ? parseFloat(options.validateThreshold)
        : defaultThreshold;

      if (!isJsonMode()) {
        console.log(
          chalk.blue(`Validating search results (method: ${method}, threshold: ${threshold})...`)
        );
      }
      validatedResults = await validateSearchResults(results, {
        method,
        threshold,
        query: options.search!,
      });

      if (validatedResults.length < results.length && !isJsonMode()) {
        console.log(
          chalk.yellow(
            `Filtered: ${results.length - validatedResults.length} irrelevant results removed`
          )
        );
      }
    }

    if (duplicatesRemoved === 0 && !isJsonMode()) {
      console.log(chalk.green(`Found ${validatedResults.length} URLs`));
    }

    if (validatedResults.length === 0) {
      if (!isJsonMode()) {
        console.log(chalk.yellow('No results found'));
        console.log(chalk.gray('\nPossible reasons:'));
        console.log(
          chalk.gray(
            '  - Search engine anti-bot protection (try again later or use a different provider)'
          )
        );
        console.log(chalk.gray('  - Query returned no results'));
        console.log(chalk.gray('  - Network connectivity issues'));
        console.log(chalk.gray('\nSuggestions:'));
        console.log(
          chalk.gray(
            `  - Try: dataset-builder scrape --search "${options.search}" --search-provider brave`
          )
        );
        console.log(
          chalk.gray(
            `  - Try: dataset-builder scrape --search "${options.search}" --search-provider bing`
          )
        );
        console.log(
          chalk.gray(
            `  - Try: dataset-builder scrape --search "${options.search}" --search-provider google`
          )
        );
        console.log(chalk.gray('  - Use --verbose flag for detailed debugging output'));
        console.log(chalk.gray('  - Provide URLs directly: dataset-builder scrape -u <url>'));
        console.log(chalk.gray('\nAPI Keys (recommended for reliable results):'));
        console.log(chalk.gray('  - Set API keys via config:'));
        console.log(chalk.gray('    dataset-builder config set braveApiKey YOUR_KEY'));
        console.log(chalk.gray('    dataset-builder config set bingApiKey YOUR_KEY'));
        console.log(chalk.gray('    dataset-builder config set googleApiKey YOUR_KEY'));
        console.log(
          chalk.gray('    dataset-builder config set googleSearchEngineId YOUR_ENGINE_ID')
        );
        console.log(chalk.gray('  - Or use command line: --search-api-key YOUR_KEY'));
      }
      return;
    }

    // Display results
    if (!isJsonMode()) {
      console.log(formatSearchResults(validatedResults));
    }

    // Scrape URLs
    const scrapeResult = await scrapeSearchResults(validatedResults, options, taskDir, results);

    if (scrapeResult.success && scrapeResult.outputFile) {
      // Structured summary
      const durationMs = scrapeResult.startTime ? Date.now() - scrapeResult.startTime : 0;
      const totalSec = Math.floor(durationMs / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      const urlCount = `${scrapeResult.successCount ?? validatedResults.length}/${validatedResults.length}`;

      if (!isJsonMode()) {
        console.log('');
        console.log(chalk.cyan('═'.repeat(50)));
        console.log(chalk.bold('  SCRAPE SUMMARY'));
        console.log(chalk.cyan('═'.repeat(50)));
        if (duplicatesRemoved > 0) {
          console.log(
            `  Search dedup:  ${chalk.gray(`${totalBefore} → ${results.length} (${duplicatesRemoved} removed)`)}`
          );
        }
        console.log(`  URLs scraped:  ${chalk.green(urlCount)}`);
        console.log(`  Records found: ${chalk.green(String(scrapeResult.totalRecords ?? 0))}`);
        console.log(`  Duration:      ${chalk.yellow(`${mm}:${ss}`)}`);
        console.log(`  Output:        ${chalk.gray(scrapeResult.outputFile)}`);
        console.log(chalk.cyan('═'.repeat(50)));
      }

      outputResult(
        'scrape',
        {
          records: scrapeResult.totalRecords ?? 0,
          urlsScraped: scrapeResult.successCount ?? validatedResults.length,
          urlsTotal: validatedResults.length,
          outputFile: scrapeResult.outputFile,
        },
        {
          duration_ms: scrapeResult.startTime ? Date.now() - scrapeResult.startTime : 0,
        }
      );

      // Handle downloads if requested
      if (options.download) {
        await handleDownloads(scrapeResult.outputFile, options, config, taskId, taskDir, logger);
      } else if (!isJsonMode()) {
        console.log(
          chalk.gray(
            '\nTip: Use --download --formats image,pdf to download files from scraped pages'
          )
        );
      }

      // Exit with PARTIAL_SUCCESS if some URLs failed
      const successCount = scrapeResult.successCount ?? validatedResults.length;
      if (successCount > 0 && successCount < validatedResults.length) {
        exitWithCode(
          ExitCode.PARTIAL_SUCCESS,
          `${successCount}/${validatedResults.length} URLs scraped successfully`
        );
      }
    } else {
      if (!isJsonMode()) {
        console.error(chalk.red('Scraping failed:'), scrapeResult.error);
      }
      const errMsg = scrapeResult.error || 'Scraping failed';
      if (
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('DNS')
      ) {
        exitWithCode(ExitCode.NETWORK_ERROR, errMsg);
      } else {
        exitWithCode(ExitCode.GENERAL_ERROR, errMsg);
      }
    }
  } catch (error) {
    if (!isJsonMode()) {
      console.error(chalk.red('Search error:'), error);
    }
    exitWithCode(ExitCode.NETWORK_ERROR, error instanceof Error ? error.message : String(error));
  }
}

/** Count items in a scraped output file (JSON array or JSONL lines) */
async function countFileRecords(filePath: string, format: string): Promise<number> {
  const fs = await import('fs/promises');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    if (format === 'jsonl') {
      return content.split('\n').filter(Boolean).length;
    }
    // JSON — could be array or single object
    const data = JSON.parse(content);
    return Array.isArray(data) ? data.length : 1;
  } catch {
    return 0;
  }
}

/** Check if a URL points directly to a downloadable file rather than an HTML page */
const DIRECT_FILE_EXTENSIONS =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|mp4|webm|avi|mov|mkv|pdf|doc|docx|ppt|pptx|xls|xlsx|csv|mp3|wav|flac|zip|rar|tar|gz)(\?[^#]*)?$/i;

function isDirectFileUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return DIRECT_FILE_EXTENSIONS.test(pathname);
  } catch {
    return DIRECT_FILE_EXTENSIONS.test(url);
  }
}

/** Scrape each search result URL and combine outputs */
async function scrapeSearchResults(
  results: SearchResult[],
  options: ScrapeOptions,
  taskDir?: string,
  allSearchResults?: SearchResult[]
): Promise<{
  success: boolean;
  outputFile?: string;
  error?: string;
  totalRecords?: number;
  successCount?: number;
  startTime?: number;
}> {
  const outputFiles: string[] = [];
  const format = options.output || 'json';

  if (!isJsonMode()) {
    console.log(chalk.gray(`Depth: ${options.depth || 1}`));
    console.log(chalk.gray(`Output format: ${format}`));
  }

  // Separate direct file URLs from HTML pages
  const directFileRecords: any[] = [];
  const scrapableResults: SearchResult[] = [];
  const seenSourceUrls = new Set<string>();

  for (const result of results) {
    if (isDirectFileUrl(result.url)) {
      directFileRecords.push({
        url: result.metadata?.sourceUrl || result.url,
        title: result.title,
        text: '',
        files: [result.url],
        links: [],
        depth: 0,
        source_chain: [result.url],
        source_url: result.metadata?.sourceUrl || result.url,
        provider: result.provider || '',
      });

      // Also scrape source page if available (smart scraping)
      const sourceUrl = result.metadata?.sourceUrl as string | undefined;
      if (sourceUrl && !seenSourceUrls.has(sourceUrl)) {
        seenSourceUrls.add(sourceUrl);
        scrapableResults.push({ ...result, url: sourceUrl });
      }
    } else {
      scrapableResults.push(result);
    }
  }

  if (directFileRecords.length > 0 && !isJsonMode()) {
    console.log(chalk.gray(`Direct file URLs: ${directFileRecords.length} (bypassing Scrapy)`));
  }

  const tracker = new ProgressTracker('Scraping');
  const scrapeStartTime = Date.now();
  const totalItems = scrapableResults.length;
  tracker.start(totalItems);
  let successCount = directFileRecords.length;
  let totalRecords = directFileRecords.length;

  for (let i = 0; i < scrapableResults.length; i++) {
    const result = scrapableResults[i];
    tracker.update(i, result.url);
    tracker.setCounters({ urls: i + 1, records: totalRecords });

    try {
      const scrapeResult = await runScrapy({
        url: result.url,
        spider: options.spider || 'basic',
        output: format,
        depth: parseInt(options.depth, 10) || 1,
        settings: options.settings,
        engine: options.engine,
        outputDir: taskDir, // BUG FIX 2: Write directly to task folder
      });

      if (scrapeResult.success && scrapeResult.outputFile) {
        outputFiles.push(scrapeResult.outputFile);
        successCount++;
        // Count actual records from the output file
        const fileRecords = await countFileRecords(scrapeResult.outputFile, format);
        totalRecords += fileRecords;
      }
    } catch (error) {
      // Tracked via counter difference
    }

    tracker.setCounters({ urls: i + 1, records: totalRecords });
  }

  tracker.update(totalItems);
  tracker.setCounters({ urls: totalItems, records: totalRecords });
  tracker.complete(
    `${successCount}/${results.length} URLs processed — ${totalRecords} records found`
  );

  // Write direct file records as a temp JSON file to combine with scrapy outputs
  if (directFileRecords.length > 0) {
    const fs = await import('fs/promises');
    const directFile = path.join(taskDir || process.cwd(), `direct_files_${Date.now()}.json`);
    await fs.mkdir(path.dirname(directFile), { recursive: true });
    await fs.writeFile(directFile, JSON.stringify(directFileRecords, null, 2), 'utf-8');
    outputFiles.push(directFile);
  }

  if (outputFiles.length === 0) {
    return { success: false, error: 'No URLs were successfully scraped' };
  }

  // Combine all output files into one
  const combinedFile = await combineScrapedOutputs(outputFiles, format, taskDir);

  // BUG FIX 2: Clean up individual temp files after combining
  const fs = await import('fs/promises');
  for (const file of outputFiles) {
    try {
      await fs.unlink(file);
    } catch {
      // Ignore errors when deleting temp files
    }
  }

  return {
    success: true,
    outputFile: combinedFile,
    totalRecords,
    successCount,
    startTime: scrapeStartTime,
  };
}

/** Combine multiple scraped output files into a single file */
async function combineScrapedOutputs(
  outputFiles: string[],
  format: string,
  taskDir?: string
): Promise<string> {
  const fs = await import('fs/promises');
  // BUG FIX 2: Use taskDir if provided, otherwise fall back to default output dir
  const outputDir = taskDir || path.join(process.cwd(), 'output');
  const timestamp = Date.now();
  const combinedFile = path.join(outputDir, `scraped_combined_${timestamp}.${format}`);

  await fs.mkdir(outputDir, { recursive: true });

  const allData: any[] = [];
  let entryIndex = 0;

  for (const file of outputFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      if (format === 'json') {
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            for (const item of data) {
              allData.push(enrichEntry(item, entryIndex++, timestamp));
            }
          } else {
            allData.push(enrichEntry(data, entryIndex++, timestamp));
          }
        } catch {
          // Skip invalid JSON files
        }
      } else if (format === 'jsonl') {
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            allData.push(enrichEntry(item, entryIndex++, timestamp));
          } catch {
            // Skip invalid JSONL lines
          }
        }
      }
    } catch (error) {
      if (!isJsonMode()) {
        console.warn(chalk.yellow(`Warning: Could not read ${file}: ${error}`));
      }
    }
  }

  // Write combined file
  if (format === 'json') {
    await fs.writeFile(combinedFile, JSON.stringify(allData, null, 2), 'utf-8');
  } else if (format === 'jsonl') {
    const lines = allData.map((item) => JSON.stringify(item)).join('\n');
    await fs.writeFile(combinedFile, lines, 'utf-8');
  }

  return combinedFile;
}

/** Enrich a scraped entry with unique ID and metadata */
function enrichEntry(
  item: any,
  index: number,
  timestamp: number,
  depth: number = 0,
  sourceChain: string[] = []
): any {
  return {
    id: `entry_${index}_${timestamp}`,
    source_url: item.url || '',
    scraped_at: new Date().toISOString(),
    depth: item.depth ?? depth,
    source_chain: item.source_chain ?? sourceChain,
    ...item,
  };
}

/** Handle downloads from scraped output - extracts file URLs from "files" field */
async function handleDownloads(
  outputFile: string,
  options: ScrapeOptions,
  config: ConfigLoader,
  taskId: string,
  taskDir: string,
  logger: DetailedLogger
): Promise<void> {
  if (!isJsonMode()) {
    console.log(chalk.blue('\nStarting downloads from scraped data...'));
  }

  // Read the output file
  const fs = await import('fs/promises');
  const fsSync = await import('fs');
  const path = await import('path');
  const content = await fs.readFile(outputFile, 'utf-8');

  let items: any[] = [];
  try {
    const data = JSON.parse(content);
    items = Array.isArray(data) ? data : [data];
  } catch {
    // Try JSONL
    items = content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  logger.info('Download preparation started', 'download', {
    taskId,
    outputFile,
    itemCount: items.length,
  });

  // Define folder structure
  const folders = {
    downloads: {
      images: path.join(taskDir, 'downloads', 'images'),
      videos: path.join(taskDir, 'downloads', 'videos'),
      pdfs: path.join(taskDir, 'downloads', 'pdfs'),
      documents: path.join(taskDir, 'downloads', 'documents'),
      csv: path.join(taskDir, 'downloads', 'csv'),
      html: path.join(taskDir, 'downloads', 'html'),
      other: path.join(taskDir, 'downloads', 'other'),
    },
    scraped: path.join(taskDir, 'scraped'),
    cleaned: path.join(taskDir, 'cleaned'),
    logs: path.join(taskDir, 'logs'),
  };

  // Create all directories
  for (const folder of Object.values(folders)) {
    if (typeof folder === 'string') {
      fsSync.mkdirSync(folder, { recursive: true });
    } else {
      for (const subfolder of Object.values(folder)) {
        fsSync.mkdirSync(subfolder, { recursive: true });
      }
    }
  }

  // Type to subdirectory mapping
  const typeToSubdir: Record<string, string> = {
    image: folders.downloads.images,
    video: folders.downloads.videos,
    pdf: folders.downloads.pdfs,
    docx: folders.downloads.documents,
    pptx: folders.downloads.documents,
    csv: folders.downloads.csv,
    html: folders.downloads.html,
    text: folders.downloads.other,
  };

  // Collect file URLs from "files" field and filter by format
  const formats = (options.formats || 'image,pdf')
    .split(',')
    .map((f: string) => f.toLowerCase().trim());
  const formatPatterns: Record<string, RegExp> = {
    image: /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp)$/i,
    video: /\.(mp4|webm|avi|mov|mkv|flv|wmv)$/i,
    pdf: /\.pdf$/i,
    pptx: /\.(ppt|pptx)$/i,
    docx: /\.(doc|docx)$/i,
    csv: /\.csv$/i,
    audio: /\.(mp3|wav|flac|aac|ogg|m4a)$/i,
    archive: /\.(zip|rar|tar|gz|bz2|7z)$/i,
    spreadsheet: /\.(xls|xlsx|ods)$/i,
    document: /\.(txt|rtf|md)$/i,
  };

  // Collect files with their source URLs and page context
  const fileUrls: {
    url: string;
    sourceUrl: string;
    sourcePageTitle: string;
    sourcePageId: string;
    pageDepth: number;
    altText: string | null;
    surroundingText: string | null;
  }[] = [];
  const seenUrls = new Set<string>();

  for (const item of items) {
    if (item.files && Array.isArray(item.files)) {
      const sourceUrl = item.source_url || item.url || ''; // Source page where files were found
      const sourcePageTitle = item.title || 'Unknown';
      const sourcePageId = item.id || '';
      const pageDepth = item.depth || 0;

      for (const fileUrl of item.files) {
        if (!fileUrl || typeof fileUrl !== 'string') continue;

        for (const format of formats) {
          const pattern = formatPatterns[format];
          const isVideoFormat = format === 'video';
          const isYouTubeVideo =
            isVideoFormat && (isYouTubeUrl(fileUrl) || isYouTubePlaylist(fileUrl));
          if ((pattern?.test(fileUrl) || isYouTubeVideo) && !seenUrls.has(fileUrl)) {
            fileUrls.push({
              url: fileUrl,
              sourceUrl,
              sourcePageTitle,
              sourcePageId,
              pageDepth,
              altText: item.alt_text || null,
              surroundingText: item.surrounding_text || null,
            });
            seenUrls.add(fileUrl);
            break;
          }
        }
      }
    }
  }

  if (fileUrls.length === 0) {
    if (!isJsonMode()) {
      console.log(chalk.yellow('No downloadable files found in scraped data'));
      console.log(
        chalk.gray('Try adjusting the --formats option (e.g., --formats image,pdf,video)')
      );
    }
    return;
  }

  if (!isJsonMode()) {
    console.log(chalk.gray(`Found ${fileUrls.length} files to download`));
    console.log(chalk.gray(`Task folder: ${taskDir}`));
  }

  let downloadItems: DownloadItem[] = [];
  for (let i = 0; i < fileUrls.length; i++) {
    const { url, sourceUrl, sourcePageTitle, sourcePageId, pageDepth, altText, surroundingText } =
      fileUrls[i];
    // Detect type from URL - default to 'text' if no match
    let type: DownloadItem['type'] = 'text';
    for (const format of formats) {
      const pattern = formatPatterns[format];
      const isVideoFormat = format === 'video';
      const isYouTubeVideo = isVideoFormat && (isYouTubeUrl(url) || isYouTubePlaylist(url));
      if (pattern?.test(url) || isYouTubeVideo) {
        // Map format to valid DownloadItem type
        const formatToType: Record<string, DownloadItem['type']> = {
          image: 'image',
          video: 'video',
          pdf: 'pdf',
          pptx: 'pptx',
          docx: 'docx',
          csv: 'csv',
          audio: 'text', // fallback to text
          archive: 'text', // fallback to text
          spreadsheet: 'csv', // use csv as closest match
          document: 'text', // fallback to text
        };
        if (formatToType[format]) {
          type = formatToType[format];
          break;
        }
      }
    }

    downloadItems.push({
      url,
      type,
      index: i,
      sourceUrl, // Pass source URL for hotlink protection bypass
      sourcePageTitle, // Page context for manifest
      sourcePageId, // Page ID for manifest
      pageDepth, // Depth in crawl
      altText, // Alt text for images
      surroundingText, // Text around link
    });
  }

  // Expand YouTube playlists into individual video items
  const playlistIndices = downloadItems
    .map((item, idx) => (isYouTubePlaylist(item.url) ? idx : -1))
    .filter((idx) => idx !== -1);

  if (playlistIndices.length > 0) {
    if (!isJsonMode()) {
      console.log(
        chalk.blue(
          `\nExpanding ${playlistIndices.length} YouTube playlist(s) into individual videos...`
        )
      );
    }
    const playlistUrls = playlistIndices.map((idx) => downloadItems[idx].url);
    const cookiesForExpand = options.ytCookies || config.get('ytCookiesFile') || undefined;
    const playlistInfos = await Promise.all(
      playlistUrls.map((url) => getPlaylistInfo(url, cookiesForExpand))
    );

    // Build expanded list: replace each playlist item with individual video items
    const expandedItems: DownloadItem[] = [];
    let playlistLookup = 0;

    for (let i = 0; i < downloadItems.length; i++) {
      if (playlistIndices.includes(i)) {
        const info = playlistInfos[playlistLookup];
        playlistLookup++;

        if (info && info.entries.length > 0) {
          if (!isJsonMode()) {
            console.log(chalk.gray(`  Playlist "${info.title}": ${info.videoCount} videos`));
          }
          for (const entry of info.entries) {
            const videoUrl = entry.id ? buildYouTubeVideoUrl(entry.id) : entry.url;
            expandedItems.push({
              url: videoUrl,
              type: 'video',
              index: expandedItems.length,
              sourceUrl: downloadItems[i].sourceUrl,
            });
          }
        } else {
          // Fallback: keep as single item if info fetch fails
          if (!isJsonMode()) {
            console.log(
              chalk.yellow(`  Playlist ${playlistLookup}: could not expand, keeping as single item`)
            );
          }
          expandedItems.push({
            ...downloadItems[i],
            index: expandedItems.length,
          });
        }
      } else {
        expandedItems.push({
          ...downloadItems[i],
          index: expandedItems.length,
        });
      }
    }

    downloadItems = expandedItems;
    if (!isJsonMode()) {
      console.log(chalk.green(`Expanded to ${downloadItems.length} individual items`));
    }
  } else if (!isJsonMode()) {
    console.log(chalk.green(`Found ${downloadItems.length} files to download`));
  }

  // Show summary and ask for confirmation
  const confirmed = await showDownloadSummary(downloadItems, downloadItems.length, options.yes, {
    skipEstimate: options.noEstimate,
    cookiesFile: options.ytCookies || config.get('ytCookiesFile') || undefined,
  });
  if (!confirmed) return;

  // Save individual scrape results to scraped/ folder
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const scrapeFile = path.join(folders.scraped, `page_${String(i + 1).padStart(3, '0')}.json`);
    await fs.writeFile(scrapeFile, JSON.stringify(item, null, 2));
  }

  // Check yt-dlp availability if YouTube URLs are queued
  const hasYouTubeItems = downloadItems.some(
    (item) => isYouTubeUrl(item.url) || isYouTubePlaylist(item.url)
  );
  if (hasYouTubeItems) {
    const ytCheck = spawnSync('yt-dlp', ['--version'], { stdio: 'pipe' });
    if (ytCheck.status !== 0 && !isJsonMode()) {
      console.log(
        chalk.yellow(
          'Warning: yt-dlp is not installed or not in PATH. YouTube downloads will fail.'
        )
      );
      console.log(chalk.gray('Install yt-dlp: pip install yt-dlp'));
    }
  }

  const concurrent = options.concurrent || config.get('maxConcurrent');
  const ytConcurrent = parseInt(options.ytConcurrent, 10) || config.get('ytConcurrent');
  const timeout = parseInt(options.timeout, 10) || 15000;

  // Build YouTube options from CLI flags or config
  const cookiesFile = options.ytCookies || config.get('ytCookiesFile') || undefined;
  const youtubeOptions = {
    quality: options.ytQuality || config.get('ytQuality'),
    audioOnly: options.ytAudioOnly || config.get('ytAudioOnly') || false,
    videoOnly: options.ytVideoOnly || config.get('ytVideoOnly') || false,
    cookiesFile,
  };

  // Create downloader with task-specific folder structure
  // Files will be organized by type in their respective subdirectories
  const retryCount = options.retry ? parseInt(options.retry, 10) : (config.get('retry') ?? 0);
  const downloader = new Downloader({
    outputDir: taskDir, // Base task dir - files will be organized by type
    concurrent,
    ytConcurrent,
    timeout,
    retry: retryCount,
    logger, // BUG FIX 4: Pass logger for per-file download logging
    youtubeOptions,
  });
  downloader.add(downloadItems);
  const result = await downloader.start();

  // Write asset manifest
  const manifestRecords = downloader.getManifestRecords();
  // Enrich records with tags from page context
  for (const record of manifestRecords) {
    record.context.tags = extractTags(record.sourcePageTitle, record.sourceUrl);
  }
  const manifest: AssetManifest = {
    taskId,
    searchQuery: options.search || null,
    generatedAt: new Date().toISOString(),
    totalAssets: manifestRecords.length,
    version: '1.0',
    assets: manifestRecords,
  };
  const manifestPath = path.join(taskDir, 'downloads', 'downloads_manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  if (!isJsonMode()) {
    console.log(chalk.gray(`Asset manifest written: ${manifestPath}`));
  }

  // Save metadata.json
  const metadata = {
    taskId,
    taskType: 'scrape',
    searchQuery: options.search || null,
    searchProvider: options.searchProvider || null,
    searchCount: options.searchCount ? parseInt(options.searchCount, 10) : null,
    concurrent,
    ytConcurrent,
    timeout,
    retry: retryCount,
    downloadEnabled: options.download,
    formats,
    youtubeOptions,
    startedAt: logger ? new Date().toISOString() : new Date().toISOString(), // Use current time as fallback
    completedAt: new Date().toISOString(),
    stats: {
      pagesScraped: items.length,
      filesDownloaded: result.completed.length,
      downloadsFailed: result.failed.length,
    },
  };
  await fs.writeFile(path.join(taskDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Copy/move the combined output file to task folder
  const combinedFileName = path.basename(outputFile);
  const taskCombinedPath = path.join(taskDir, combinedFileName);
  await fs.copyFile(outputFile, taskCombinedPath);

  if (!isJsonMode()) {
    console.log(
      chalk.green(
        `Downloads complete: ${result.completed.length} succeeded, ${result.failed.length} failed`
      )
    );
    console.log(chalk.gray(`Output: ${taskDir}`));
  }
}
