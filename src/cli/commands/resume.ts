/**
 * Resume command - Resume downloads from an existing task folder
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import fs from 'fs/promises';
import fsSync from 'fs';
import { spawnSync } from 'child_process';
import { Downloader, DownloadItem } from '../../downloader';
import {
  isYouTubeUrl,
  isYouTubePlaylist,
  getPlaylistInfo,
  buildYouTubeVideoUrl,
} from '../../downloader/videoHandler';
import { AssetManifest, AssetRecord } from '../../downloader/types';
import { mergeManifests, createEmptyManifest, extractTags } from '../../downloader/manifest-utils';
import { DetailedLogger } from '../../utils/detailedLogger';
import { generateTaskId } from '../../utils/taskManager';
import { showDownloadSummary } from '../../utils/downloadSummary';

export const resumeCommand = new Command('resume')
  .description('Resume downloads from an existing task folder')
  .argument('<task-directory>', 'Path to the task directory to resume')
  .option('--overwrite', 'Overwrite existing files without prompting', false)
  .option('-c, --concurrent <number>', 'Max concurrent downloads (default: from metadata or 5)')
  .option(
    '--yt-concurrent <number>',
    'Max concurrent YouTube downloads (default: from metadata or 1)'
  )
  .option(
    '-t, --timeout <number>',
    'Download timeout in milliseconds (default: from metadata or 15000)'
  )
  .option('--verbose', 'Enable verbose logging')
  .option('--yt-quality <resolution>', 'YouTube video quality (e.g., 720, 1080, best)')
  .option('--yt-audio-only', 'Download YouTube audio only (MP3)', false)
  .option('--yt-video-only', 'Download YouTube video only (no audio)', false)
  .option(
    '--yt-cookies [path]',
    'Path to cookies.txt file for YouTube auth (default: .temp/www.youtube.com_cookies.txt)'
  )
  .option('-y, --yes', 'Skip download confirmation prompt', false)
  .option('--no-estimate', 'Skip download size estimation')
  .option('--retry <count>', 'Number of download retries (default: 0, no retries)')
  .action(
    wrapAction('resume', async (taskDir: string, options) => {
      // Resolve task directory path
      const resolvedTaskDir = path.resolve(taskDir);

      // Display task info header
      if (!isJsonMode()) {
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.bold('  Resume Downloads'));
        console.log(chalk.bold('  Task Directory:'), chalk.yellow(resolvedTaskDir));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log();
      }

      // Check if directory exists
      try {
        const stat = await fs.stat(resolvedTaskDir);
        if (!stat.isDirectory()) {
          if (!isJsonMode()) {
            console.error(chalk.red('Error: Path is not a directory:'), taskDir);
          }
          exitWithCode(ExitCode.INVALID_INPUT, `Path is not a directory: ${taskDir}`);
        }
      } catch (error) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: Task directory not found:'), taskDir);
        }
        exitWithCode(ExitCode.INVALID_INPUT, `Task directory not found: ${taskDir}`);
      }

      // Load metadata
      const metadataPath = path.join(resolvedTaskDir, 'metadata.json');
      let metadata: any;
      try {
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metadataContent);
      } catch (error) {
        if (!isJsonMode()) {
          console.error(chalk.red('Error: Could not read metadata.json from task directory'));
          console.error(
            chalk.gray('Make sure this is a valid task directory created by the scrape command')
          );
        }
        exitWithCode(ExitCode.INVALID_INPUT, 'Could not read metadata.json from task directory');
      }

      // Load combined JSON data
      const combinedPath = path.join(
        resolvedTaskDir,
        metadata.searchQuery ? 'scraped_combined.json' : 'output.json'
      );
      let combinedData: any[] = [];
      try {
        // Try to find the combined file
        const files = await fs.readdir(resolvedTaskDir);
        const combinedFile = files.find(
          (f) => f.startsWith('scraped_combined') && f.endsWith('.json')
        );
        if (combinedFile) {
          const content = await fs.readFile(path.join(resolvedTaskDir, combinedFile), 'utf-8');
          combinedData = JSON.parse(content);
        } else {
          if (!isJsonMode()) {
            console.warn(chalk.yellow('Warning: Could not find combined scraped data'));
          }
        }
      } catch (error) {
        if (!isJsonMode()) {
          console.warn(chalk.yellow('Warning: Could not read scraped data'));
        }
      }

      // Initialize logger
      const logger = new DetailedLogger({
        taskDir: resolvedTaskDir,
        taskId: metadata.taskId || generateTaskId(),
        verbose: options.verbose,
      });
      await logger.initialize();

      logger.info('Resume operation started', 'resume', {
        taskDir: resolvedTaskDir,
        originalTaskId: metadata.taskId,
      });

      // Scan downloads directory for existing files
      const downloadsDir = path.join(resolvedTaskDir, 'downloads');
      const existingFiles = await scanExistingFiles(downloadsDir);

      if (!isJsonMode()) {
        console.log(chalk.blue('Scanning task directory...'));
        console.log(chalk.gray(`  Original task ID: ${metadata.taskId}`));
        console.log(chalk.gray(`  Started at: ${metadata.startedAt}`));
        console.log(chalk.gray(`  Found ${existingFiles.length} existing files`));
        console.log();
      }

      // Collect files to download
      const filesToDownload: Array<{
        url: string;
        sourceUrl: string;
        filename: string;
        type: DownloadItem['type'];
      }> = [];
      const filesToSkip: Array<{ filename: string; reason: string }> = [];

      // Check each item for files
      const formats = metadata.formats || ['image', 'pdf'];
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

      const formatToType: Record<string, DownloadItem['type']> = {
        image: 'image',
        video: 'video',
        pdf: 'pdf',
        pptx: 'pptx',
        docx: 'docx',
        csv: 'csv',
        audio: 'text',
        archive: 'text',
        spreadsheet: 'csv',
        document: 'text',
      };

      // Build map of expected files from metadata
      const seenUrls = new Set<string>();

      for (const item of combinedData) {
        if (item.files && Array.isArray(item.files)) {
          const sourceUrl = item.source_url || item.url || '';
          for (const fileUrl of item.files) {
            if (!fileUrl || typeof fileUrl !== 'string') continue;
            if (seenUrls.has(fileUrl)) continue;

            // Check if file matches any requested format
            let matchedType: DownloadItem['type'] | null = null;
            for (const format of formats) {
              const pattern = formatPatterns[format];
              const isVideoFormat = format === 'video';
              const isYouTube =
                isVideoFormat && (isYouTubeUrl(fileUrl) || isYouTubePlaylist(fileUrl));
              if ((pattern && pattern.test(fileUrl)) || isYouTube) {
                matchedType = formatToType[format] || 'text';
                break;
              }
            }

            if (!matchedType) continue;

            // Check if file already exists
            const filename = getFilenameFromUrl(fileUrl);
            const existingFile = existingFiles.find((f) => f.filename === filename);

            if (existingFile) {
              if (options.overwrite) {
                filesToDownload.push({ url: fileUrl, sourceUrl, filename, type: matchedType });
              } else {
                filesToSkip.push({ filename, reason: 'Already exists' });
              }
            } else {
              filesToDownload.push({ url: fileUrl, sourceUrl, filename, type: matchedType });
            }

            seenUrls.add(fileUrl);
          }
        }
      }

      if (!isJsonMode()) {
        console.log(chalk.green(`Found ${filesToDownload.length} files to download`));
        console.log(chalk.gray(`  ${filesToSkip.length} files already exist`));
        console.log();
      }

      // Handle --dry-run early
      if (getGlobalFlags().dryRun || process.env.DRY_RUN === 'true') {
        outputResult('resume', {
          dry_run: true,
          command: 'resume',
          planned_actions: [
            `Task directory: ${resolvedTaskDir}`,
            `Original task ID: ${metadata.taskId}`,
            `Files to download: ${filesToDownload.length}`,
            `Files already present: ${filesToSkip.length}`,
            `Overwrite: ${options.overwrite ? 'yes' : 'no'}`,
          ],
          estimated: {
            pending_downloads: filesToDownload.length,
            existing_files: filesToSkip.length,
          },
        });
        if (!isJsonMode()) {
          console.log(chalk.yellow('Dry run - no downloads will be started.'));
          console.log(chalk.gray(`  Files to download: ${filesToDownload.length}`));
          console.log(chalk.gray(`  Files already present: ${filesToSkip.length}`));
        }
        return;
      }

      if (filesToDownload.length === 0) {
        if (!isJsonMode()) {
          console.log(chalk.yellow('No new files to download'));
          if (filesToSkip.length > 0) {
            console.log(
              chalk.gray(`All ${filesToSkip.length} files already exist in the downloads folder`)
            );
            console.log(chalk.gray('Use --overwrite to re-download existing files'));
          }
        }
        return;
      }

      // Prompt for existing files if not using --overwrite
      if (!options.overwrite && filesToSkip.length > 0 && !isJsonMode()) {
        console.log(chalk.cyan('Existing files (will be skipped):'));
        for (const file of filesToSkip.slice(0, 5)) {
          console.log(chalk.gray(`  ${file.filename}`));
        }
        if (filesToSkip.length > 5) {
          console.log(chalk.gray(`  ... and ${filesToSkip.length - 5} more`));
        }
        console.log();
      }

      // Prepare download items
      let downloadItems: DownloadItem[] = filesToDownload.map((file, index) => ({
        url: file.url,
        type: file.type,
        filename: file.filename,
        index,
        sourceUrl: file.sourceUrl,
      }));

      // Expand YouTube playlists into individual video items
      const playlistIndices = downloadItems
        .map((item, idx) => (isYouTubePlaylist(item.url) ? idx : -1))
        .filter((idx) => idx !== -1);

      if (playlistIndices.length > 0) {
        if (!isJsonMode()) {
          console.log(
            chalk.blue(
              `Expanding ${playlistIndices.length} YouTube playlist(s) into individual videos...`
            )
          );
        }
        const playlistUrls = playlistIndices.map((idx) => downloadItems[idx].url);
        const metadataYtOptsExpand = metadata.youtubeOptions || {};
        const cookiesForExpand = options.ytCookies || metadataYtOptsExpand.cookiesFile || undefined;
        const playlistInfos = await Promise.all(
          playlistUrls.map((url) => getPlaylistInfo(url, cookiesForExpand))
        );

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
              if (!isJsonMode()) {
                console.log(
                  chalk.yellow(
                    `  Playlist ${playlistLookup}: could not expand, keeping as single item`
                  )
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
          console.log(chalk.green(`  Expanded to ${downloadItems.length} individual items`));
          console.log();
        }
      }

      // Show summary and ask for confirmation
      const metadataYtOptsSummary = metadata.youtubeOptions || {};
      const cookiesForSummary = options.ytCookies || metadataYtOptsSummary.cookiesFile || undefined;
      const confirmed = await showDownloadSummary(
        downloadItems,
        downloadItems.length,
        options.yes,
        {
          skipEstimate: options.noEstimate,
          cookiesFile: cookiesForSummary,
        }
      );
      if (!confirmed) return;

      // Check yt-dlp availability if YouTube URLs are queued
      const hasYouTubeItems = downloadItems.some(
        (item) => isYouTubeUrl(item.url) || isYouTubePlaylist(item.url)
      );
      if (hasYouTubeItems) {
        const ytCheck = spawnSync('yt-dlp', ['--version'], { stdio: 'pipe' });
        if (ytCheck.status !== 0) {
          if (!isJsonMode()) {
            console.log(
              chalk.yellow(
                'Warning: yt-dlp is not installed or not in PATH. YouTube downloads will fail.'
              )
            );
            console.log(chalk.gray('Install yt-dlp: pip install yt-dlp'));
          }
        }
      }

      // Get settings
      const concurrent = parseInt(options.concurrent, 10) || metadata.concurrent || 5;
      const ytConcurrent = parseInt(options.ytConcurrent, 10) || metadata.ytConcurrent || 1;
      const timeout = parseInt(options.timeout, 10) || metadata.timeout || 15000;

      if (!isJsonMode()) {
        console.log(chalk.blue('Starting downloads...'));
        console.log(chalk.gray(`  Concurrent: ${concurrent}, YT-concurrent: ${ytConcurrent}`));
        console.log(chalk.gray(`  Timeout: ${timeout}ms`));
        console.log();
      }

      // Log resume operation
      logger.logResume(resolvedTaskDir, existingFiles.length, filesToDownload.length);

      // Build YouTube options from CLI flags, falling back to metadata values
      const metadataYtOpts = metadata.youtubeOptions || {};
      const cookiesFile = options.ytCookies || metadataYtOpts.cookiesFile || undefined;
      const youtubeOptions = {
        quality: options.ytQuality || metadataYtOpts.quality,
        audioOnly: options.ytAudioOnly || metadataYtOpts.audioOnly || false,
        videoOnly: options.ytVideoOnly || metadataYtOpts.videoOnly || false,
        cookiesFile,
      };

      // Run downloads with manifest tracking
      const retryCount = options.retry ? parseInt(options.retry, 10) : (metadata.retry ?? 0);
      const downloader = new Downloader({
        outputDir: resolvedTaskDir,
        concurrent,
        ytConcurrent,
        timeout,
        retry: retryCount,
        verbose: options.verbose,
        youtubeOptions,
      });
      downloader.add(downloadItems);
      const result = await downloader.start();

      // Write/merge asset manifest
      const manifestRecords = downloader.getManifestRecords();
      // Enrich records with tags
      for (const record of manifestRecords) {
        record.context.tags = extractTags(record.sourcePageTitle, record.sourceUrl);
      }

      const manifestPath = path.join(resolvedTaskDir, 'downloads', 'downloads_manifest.json');
      let manifest: AssetManifest;

      // Try to load existing manifest
      try {
        const existingManifestContent = await fs.readFile(manifestPath, 'utf-8');
        const existingManifest: AssetManifest = JSON.parse(existingManifestContent);
        const newManifest: AssetManifest = {
          taskId: metadata.taskId,
          searchQuery: metadata.searchQuery || null,
          generatedAt: new Date().toISOString(),
          totalAssets: manifestRecords.length,
          version: '1.0',
          assets: manifestRecords,
        };
        manifest = mergeManifests(existingManifest, newManifest);
        if (!isJsonMode()) {
          console.log(chalk.gray(`Merged manifest with existing records`));
        }
      } catch {
        // No existing manifest, create new one
        manifest = {
          taskId: metadata.taskId,
          searchQuery: metadata.searchQuery || null,
          generatedAt: new Date().toISOString(),
          totalAssets: manifestRecords.length,
          version: '1.0',
          assets: manifestRecords,
        };
      }

      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      if (!isJsonMode()) {
        console.log(chalk.gray(`Asset manifest written: ${manifestPath}`));
      }

      // Update metadata
      const updatedMetadata = {
        ...metadata,
        taskType: metadata.taskType || 'scrape',
        ytConcurrent,
        resumedAt: new Date().toISOString(),
        resumeCount: (metadata.resumeCount || 0) + 1,
        stats: {
          ...metadata.stats,
          filesDownloaded: (metadata.stats?.filesDownloaded || 0) + result.completed.length,
          downloadsFailed: (metadata.stats?.downloadsFailed || 0) + result.failed.length,
        },
      };

      await fs.writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2));

      // Log results
      logger.info('Resume operation completed', 'resume', {
        completed: result.completed.length,
        failed: result.failed.length,
        total: filesToDownload.length,
      });

      if (!isJsonMode()) {
        console.log();
        console.log(chalk.green('Resume complete!'));
        console.log(chalk.gray(`  Downloaded: ${result.completed.length}`));
        console.log(chalk.gray(`  Failed: ${result.failed.length}`));
        console.log(chalk.gray(`  Skipped: ${filesToSkip.length}`));
        console.log(chalk.gray(`  Output: ${resolvedTaskDir}`));
      }

      outputResult('resume', {
        downloaded: result.completed.length,
        failed: result.failed.length,
        skipped: filesToSkip.length,
        outputDir: resolvedTaskDir,
      });
    })
  );

/** Scan existing files in downloads directory */
async function scanExistingFiles(
  downloadsDir: string
): Promise<Array<{ filename: string; path: string; size: number }>> {
  const files: Array<{ filename: string; path: string; size: number }> = [];

  try {
    const subdirs = ['images', 'videos', 'pdfs', 'documents', 'csv', 'html', 'other'];
    for (const subdir of subdirs) {
      const subdirPath = path.join(downloadsDir, subdir);
      try {
        const entries = await fs.readdir(subdirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const filePath = path.join(subdirPath, entry.name);
            const stat = await fs.stat(filePath);
            files.push({
              filename: entry.name,
              path: filePath,
              size: stat.size,
            });
          }
        }
      } catch {
        // Subdir might not exist, skip
      }
    }
  } catch {
    // Downloads dir might not exist
  }

  return files;
}

/** Extract filename from URL */
function getFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = path.basename(pathname);
    if (filename && filename.includes('.')) {
      return filename;
    }
  } catch {
    // Invalid URL
  }
  // Generate filename from timestamp and random
  return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
