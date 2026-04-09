/**
 * Media compression module using ffmpeg
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface CompressOptions {
  codec?: 'h264' | 'h265' | 'av1';
  quality?: number; // CRF value (0-51, default 23)
  imageQuality?: number; // Image quality (1-100, default 85)
  format?: 'mp4' | 'webm' | 'mkv';
  keepOriginal?: boolean;
}

export interface CompressResult {
  file: string;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  success: boolean;
  error?: string;
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.avi',
  '.mov',
  '.flv',
  '.wmv',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ogv',
  '.ts',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp']);

const CODEC_MAP: Record<string, string> = {
  h264: 'libx264',
  h265: 'libx265',
  av1: 'libsvtav1',
};

/** Check if ffmpeg is available on the system */
export function checkFfmpeg(): boolean {
  try {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Get media duration in seconds using ffprobe */
export async function getMediaDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'quiet',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]);

    let output = '';

    ffprobe.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ffprobe.on('close', () => {
      const duration = parseFloat(output.trim());
      resolve(isNaN(duration) ? 0 : duration);
    });

    ffprobe.on('error', () => {
      resolve(0);
    });
  });
}

/** Recursively find media files in a directory */
export async function findMediaFiles(dir: string): Promise<{ videos: string[]; images: string[] }> {
  const videos: string[] = [];
  const images: string[] = [];

  async function scan(currentDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          videos.push(fullPath);
        } else if (IMAGE_EXTENSIONS.has(ext)) {
          images.push(fullPath);
        }
      }
    }
  }

  await scan(dir);
  return { videos, images };
}

/** Compress a video file using ffmpeg */
export async function compressVideo(
  input: string,
  options: CompressOptions = {},
  onProgress?: (percent: number) => void
): Promise<CompressResult> {
  const originalSize = fs.statSync(input).size;
  const codec = options.codec || 'h264';
  const crf = options.quality ?? 23;
  const outputExt = options.format ? `.${options.format}` : path.extname(input);
  const tmpOutput = input + '.tmp' + outputExt;

  const ffmpegCodec = CODEC_MAP[codec] || 'libx264';

  const args: string[] = [
    '-i',
    input,
    '-c:v',
    ffmpegCodec,
    '-crf',
    crf.toString(),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-y', // Overwrite output
    tmpOutput,
  ];

  // Get duration for progress tracking
  const duration = await getMediaDuration(input);

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', args);

    let stderrOutput = '';

    ffmpeg.stderr.on('data', (data: Buffer) => {
      const output = data.toString();
      stderrOutput += output;

      // Parse progress from ffmpeg's time= output
      if (onProgress && duration > 0) {
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseInt(timeMatch[3]);
          const ms = parseInt(timeMatch[4]);
          const currentTime = hours * 3600 + minutes * 60 + seconds + ms / 100;
          const percent = Math.min(100, (currentTime / duration) * 100);
          onProgress(percent);
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpOutput)) {
        const compressedSize = fs.statSync(tmpOutput).size;

        if (options.keepOriginal) {
          // Rename temp to final output next to original
          const finalOutput = input.replace(path.extname(input), '.compressed' + outputExt);
          fs.renameSync(tmpOutput, finalOutput);
        } else {
          // Replace original
          fs.unlinkSync(input);
          const finalPath = input.replace(path.extname(input), outputExt);
          fs.renameSync(tmpOutput, finalPath);
        }

        const savings =
          originalSize > 0 ? ((originalSize - compressedSize) / originalSize) * 100 : 0;

        resolve({
          file: input,
          originalSize,
          compressedSize,
          savingsPercent: Math.round(savings * 10) / 10,
          success: true,
        });
      } else {
        // Clean up temp file on failure
        try {
          if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
        } catch {
          /* ignore */
        }

        resolve({
          file: input,
          originalSize,
          compressedSize: originalSize,
          savingsPercent: 0,
          success: false,
          error: `ffmpeg exited with code ${code}: ${stderrOutput.slice(-300)}`,
        });
      }
    });

    ffmpeg.on('error', (error) => {
      try {
        if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
      } catch {
        /* ignore */
      }

      resolve({
        file: input,
        originalSize,
        compressedSize: originalSize,
        savingsPercent: 0,
        success: false,
        error: error.message,
      });
    });
  });
}

/** Compress an image file using ffmpeg */
export async function compressImage(
  input: string,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const originalSize = fs.statSync(input).size;
  const quality = options.imageQuality ?? 85;
  const ext = path.extname(input).toLowerCase();
  const tmpOutput = input + '.tmp' + ext;

  const args: string[] = ['-i', input];

  if (ext === '.jpg' || ext === '.jpeg') {
    args.push('-q:v', Math.round(((100 - quality) * 31) / 100).toString());
  } else if (ext === '.png') {
    // PNG compression level (0-100 mapped to compression_level)
    args.push('-compression_level', Math.round((100 - quality) / 10).toString());
  } else if (ext === '.webp') {
    args.push('-quality', quality.toString());
  }

  args.push('-y', tmpOutput);

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', args);

    let stderrOutput = '';

    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpOutput)) {
        const compressedSize = fs.statSync(tmpOutput).size;

        if (options.keepOriginal) {
          const finalOutput = input.replace(ext, '.compressed' + ext);
          fs.renameSync(tmpOutput, finalOutput);
        } else {
          fs.unlinkSync(input);
          fs.renameSync(tmpOutput, input);
        }

        const savings =
          originalSize > 0 ? ((originalSize - compressedSize) / originalSize) * 100 : 0;

        resolve({
          file: input,
          originalSize,
          compressedSize,
          savingsPercent: Math.round(savings * 10) / 10,
          success: true,
        });
      } else {
        try {
          if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
        } catch {
          /* ignore */
        }

        resolve({
          file: input,
          originalSize,
          compressedSize: originalSize,
          savingsPercent: 0,
          success: false,
          error: `ffmpeg exited with code ${code}: ${stderrOutput.slice(-300)}`,
        });
      }
    });

    ffmpeg.on('error', (error) => {
      try {
        if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
      } catch {
        /* ignore */
      }

      resolve({
        file: input,
        originalSize,
        compressedSize: originalSize,
        savingsPercent: 0,
        success: false,
        error: error.message,
      });
    });
  });
}

// formatBytes is now imported from utils/tui.ts — re-export for backward compatibility
export { formatBytes } from '../utils/tui';
