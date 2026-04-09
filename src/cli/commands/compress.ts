/**
 * Compress command - Compress media files using ffmpeg
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { confirm } from '../../utils/confirm';
import { outputResult, isJsonMode, getGlobalFlags } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import {
  checkFfmpeg,
  findMediaFiles,
  compressVideo,
  compressImage,
  formatBytes,
  CompressResult,
} from '../../compressor';

export const compressCommand = new Command('compress')
  .description('Compress video and image files using ffmpeg')
  .argument('<path>', 'Directory containing media files to compress')
  .addOption(
    new Option('--codec <codec>', 'Video codec: h264, h265, av1 (default: h264)')
      .choices(['h264', 'h265', 'av1'])
      .default('h264')
  )
  .option('--quality <crf>', 'Video CRF quality value 0-51 (default: 23, lower = better)', '23')
  .option('--image-quality <quality>', 'Image quality 1-100 (default: 85)', '85')
  .addOption(
    new Option('--format <format>', 'Output container format: mp4, webm, mkv').choices([
      'mp4',
      'webm',
      'mkv',
    ])
  )
  .option('--keep-original', 'Keep original files (default: replace)', false)
  .option('--dry-run', 'Show what would be compressed without doing it', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(
    wrapAction('compress', async (targetPath: string, options) => {
      const resolvedPath = path.resolve(targetPath);
      const jsonMode = isJsonMode();

      if (!jsonMode) {
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.bold('  Media Compression'));
        console.log(chalk.bold('  Path:'), chalk.yellow(resolvedPath));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log();
      }

      // Check ffmpeg availability
      if (!checkFfmpeg()) {
        if (!jsonMode) {
          console.error(chalk.red('Error: ffmpeg is not installed or not in PATH'));
          console.log(chalk.gray('Install ffmpeg: https://ffmpeg.org/download.html'));
        }
        exitWithCode(ExitCode.MISSING_DEPENDENCY, 'ffmpeg is not installed or not in PATH');
      }

      // Find media files
      if (!jsonMode) {
        console.log(chalk.blue('Scanning for media files...'));
      }
      const { videos, images } = await findMediaFiles(resolvedPath);

      if (videos.length === 0 && images.length === 0) {
        if (!jsonMode) {
          console.log(chalk.yellow('No media files found in the specified path'));
        }
        return;
      }

      // Calculate total size
      const fs = await import('fs');
      let totalOriginalSize = 0;
      for (const file of [...videos, ...images]) {
        try {
          totalOriginalSize += fs.statSync(file).size;
        } catch {
          /* skip */
        }
      }

      // Show summary
      if (!jsonMode) {
        console.log();
        console.log(chalk.bold('Files found:'));
        if (videos.length > 0) {
          console.log(`  ${chalk.cyan('Videos:')} ${videos.length} files`);
        }
        if (images.length > 0) {
          console.log(`  ${chalk.cyan('Images:')} ${images.length} files`);
        }
        console.log(`  ${chalk.bold('Total size:')} ${formatBytes(totalOriginalSize)}`);
        console.log();

        // Show settings
        console.log(chalk.bold('Settings:'));
        console.log(`  Codec: ${options.codec}`);
        console.log(`  Video quality (CRF): ${options.quality}`);
        console.log(`  Image quality: ${options.imageQuality}`);
        if (options.format) console.log(`  Output format: ${options.format}`);
        console.log(`  Keep originals: ${options.keepOriginal ? 'yes' : 'no (replace)'}`);
        console.log();
      }

      if (options.dryRun || getGlobalFlags().dryRun) {
        if (!jsonMode) {
          console.log(chalk.yellow('Dry run - no files will be compressed.'));
          console.log();
          console.log(chalk.bold('Videos:'));
          for (const v of videos) {
            const size = formatBytes(fs.statSync(v).size);
            console.log(`  ${chalk.gray(path.relative(resolvedPath, v))} (${size})`);
          }
          if (images.length > 0) {
            console.log(chalk.bold('Images:'));
            for (const img of images) {
              const size = formatBytes(fs.statSync(img).size);
              console.log(`  ${chalk.gray(path.relative(resolvedPath, img))} (${size})`);
            }
          }
        }
        outputResult('compress', {
          dry_run: true,
          command: 'compress',
          planned_actions: [
            ...videos.map((v) => `Compress video: ${path.relative(resolvedPath, v)}`),
            ...images.map((img) => `Compress image: ${path.relative(resolvedPath, img)}`),
          ],
          estimated: {
            files: videos.length + images.length,
            size_bytes: totalOriginalSize,
          },
        });
        return;
      }

      // Confirmation
      if (!options.yes) {
        const msg = options.keepOriginal
          ? 'Compress these files?'
          : 'Compress and REPLACE original files?';
        const confirmed = await confirm(msg, true);
        if (!confirmed) {
          if (!jsonMode) {
            console.log(chalk.yellow('Compression cancelled.'));
          }
          return;
        }
      }

      // Process files
      const results: CompressResult[] = [];
      const total = videos.length + images.length;
      let current = 0;

      // Compress videos
      for (const video of videos) {
        current++;
        const relPath = path.relative(resolvedPath, video);
        if (!jsonMode) {
          process.stdout.write(
            `  [${current}/${total}] ${chalk.blue('Compressing')} ${relPath}...`
          );
        }

        const result = await compressVideo(
          video,
          {
            codec: options.codec as 'h264' | 'h265' | 'av1',
            quality: parseInt(options.quality, 10),
            format: options.format,
            keepOriginal: options.keepOriginal,
          },
          (percent) => {
            if (!jsonMode) {
              process.stdout.write(
                `\r  [${current}/${total}] ${chalk.blue('Compressing')} ${relPath}... ${percent.toFixed(1)}%`
              );
            }
          }
        );

        results.push(result);

        if (!jsonMode) {
          if (result.success) {
            console.log(
              `\r  [${current}/${total}] ${chalk.green('✓')} ${relPath} ` +
                `${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)} ` +
                `(${chalk.green(`-${result.savingsPercent}%`)})`
            );
          } else {
            console.log(`\r  [${current}/${total}] ${chalk.red('✗')} ${relPath}: ${result.error}`);
          }
        }
      }

      // Compress images
      for (const image of images) {
        current++;
        const relPath = path.relative(resolvedPath, image);
        if (!jsonMode) {
          process.stdout.write(
            `  [${current}/${total}] ${chalk.blue('Compressing')} ${relPath}...`
          );
        }

        const result = await compressImage(image, {
          imageQuality: parseInt(options.imageQuality, 10),
          keepOriginal: options.keepOriginal,
        });

        results.push(result);

        if (!jsonMode) {
          if (result.success) {
            console.log(
              `\r  [${current}/${total}] ${chalk.green('✓')} ${relPath} ` +
                `${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)} ` +
                `(${chalk.green(`-${result.savingsPercent}%`)})`
            );
          } else {
            console.log(`\r  [${current}/${total}] ${chalk.red('✗')} ${relPath}: ${result.error}`);
          }
        }
      }

      // Print final summary
      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      const totalOriginal = succeeded.reduce((s, r) => s + r.originalSize, 0);
      const totalCompressed = succeeded.reduce((s, r) => s + r.compressedSize, 0);
      const totalSaved = totalOriginal - totalCompressed;
      const overallPercent =
        totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 1000) / 10 : 0;

      if (!jsonMode) {
        console.log();
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.bold('  Compression Summary'));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(`  ${chalk.green('✓')} Compressed: ${succeeded.length}`);
        if (failed.length > 0) {
          console.log(`  ${chalk.red('✗')} Failed: ${failed.length}`);
        }
        console.log(`  Original size:    ${formatBytes(totalOriginal)}`);
        console.log(`  Compressed size:  ${formatBytes(totalCompressed)}`);
        console.log(
          `  Space saved:      ${chalk.green(formatBytes(totalSaved))} (${overallPercent}%)`
        );
        console.log(chalk.cyan('═'.repeat(60)));
      }

      outputResult('compress', {
        succeeded: succeeded.length,
        failed: failed.length,
        originalSize: totalOriginal,
        compressedSize: totalCompressed,
        savedBytes: totalSaved,
        savingsPercent: overallPercent,
      });
    })
  );
