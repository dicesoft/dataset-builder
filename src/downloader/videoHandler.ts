/**
 * Video download handler using yt-dlp for YouTube and other video platforms
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { validatePathBoundary } from '../utils/pathValidation';

export interface YouTubeDownloadOptions {
  quality?: 'best' | 'worst' | string;
  audioOnly?: boolean;
  videoOnly?: boolean;
  cookiesFile?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface YouTubeDownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
  filesCount?: number;
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
  '.ogg',
  '.ogv',
  '.mp3',
  '.m4a',
  '.opus',
  '.aac',
  '.flac',
  '.wav',
]);

function countDownloadedFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countDownloadedFiles(fullPath);
    } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      count++;
    }
  }
  return count;
}

/**
 * Check if a URL is a YouTube video URL
 */
export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|www\.youtube\.com\/watch\?v=|www\.youtube\.com\/shorts\/)/i.test(
    url
  );
}

/**
 * Check if a URL is a YouTube playlist URL
 */
export function isYouTubePlaylist(url: string): boolean {
  return /(?:youtube\.com\/playlist\?list=|www\.youtube\.com\/playlist\?list=)/i.test(url);
}

/**
 * Build a YouTube video URL from a video ID
 */
export function buildYouTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Download a YouTube video using yt-dlp
 */
export async function downloadYouTubeVideo(
  url: string,
  outputDir: string,
  options: YouTubeDownloadOptions = {}
): Promise<YouTubeDownloadResult> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [
    '-o',
    path.join(outputDir, '%(title)s.%(ext)s'),
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-warnings',
    '--js-runtimes',
    'node',
  ];

  // Add cookie authentication if specified (with path traversal validation)
  if (options.cookiesFile) {
    validatePathBoundary(options.cookiesFile, process.cwd());
    args.push('--cookies', options.cookiesFile);
  }

  // Add quality/format options
  if (options.audioOnly) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (options.videoOnly) {
    args.push('-f', 'bestvideo[height<=1080]/bestvideo');
  } else if (options.quality) {
    if (options.quality === 'best') {
      args.push('-f', 'bestvideo+bestaudio/best');
    } else if (options.quality === 'worst') {
      args.push('-f', 'worst');
    } else {
      // Treat as resolution number (e.g., "720", "1080")
      const res = options.quality.replace('p', '');
      args.push('-f', `bestvideo[height<=${res}]+bestaudio/best[height<=${res}]`);
    }
  } else {
    // Default: best quality up to 1080p
    args.push('-f', 'best[height<=1080]/best');
  }

  args.push(url);

  return new Promise((resolve) => {
    // If already aborted before spawning, resolve immediately
    if (options.signal?.aborted) {
      resolve({ success: false, error: 'Aborted' });
      return;
    }

    const ytdlp = spawn('yt-dlp', args);

    let lastOutput = '';
    let downloadedFilePath: string | undefined;

    // Listen for abort signal to kill the yt-dlp process
    const onAbort = () => {
      ytdlp.kill();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    ytdlp.stdout.on('data', (data: Buffer) => {
      const output = data.toString();
      lastOutput += output;

      // Parse progress from yt-dlp output
      // Format: [download]  12.3% of ~123.45MiB at  1.23MiB/s ETA 00:45
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch && options.onProgress) {
        const percent = parseFloat(progressMatch[1]);
        options.onProgress(percent);
      }

      // Extract destination file path
      // Format: [download] Destination: /path/to/file.mp4
      const destMatch = output.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        downloadedFilePath = destMatch[1].trim();
      }

      // Extract file path for already downloaded files
      // Format: [download] /path/to/file.mp4 has already been downloaded
      const alreadyDownloadedMatch = output.match(/\[download\] (.+) has already been downloaded/);
      if (alreadyDownloadedMatch) {
        downloadedFilePath = alreadyDownloadedMatch[1].trim();
      }
    });

    ytdlp.stderr.on('data', (data: Buffer) => {
      lastOutput += data.toString();
    });

    ytdlp.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);

      // If aborted, resolve as failed/aborted regardless of exit code
      if (options.signal?.aborted) {
        resolve({ success: false, error: 'Aborted' });
        return;
      }

      if (code === 0) {
        resolve({
          success: true,
          filePath: downloadedFilePath,
        });
      } else {
        // Check if it's already downloaded
        if (lastOutput.includes('has already been downloaded') && downloadedFilePath) {
          resolve({
            success: true,
            filePath: downloadedFilePath,
          });
          return;
        }

        // Check if the file was actually downloaded despite non-zero exit
        if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
          resolve({
            success: true,
            filePath: downloadedFilePath,
          });
          return;
        }

        // Check output directory for any downloaded files
        const downloadedFiles = countDownloadedFiles(outputDir);
        if (downloadedFiles > 0) {
          resolve({
            success: true,
            filePath: downloadedFilePath || outputDir,
            filesCount: downloadedFiles,
          });
          return;
        }

        resolve({
          success: false,
          error: `yt-dlp exited with code ${code}: ${lastOutput.slice(-500)}`,
        });
      }
    });

    ytdlp.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);

      if (error.message?.includes('ENOENT')) {
        resolve({
          success: false,
          error:
            'yt-dlp not found. Please install yt-dlp: https://github.com/yt-dlp/yt-dlp#installation',
        });
      } else {
        resolve({
          success: false,
          error: error.message,
        });
      }
    });
  });
}

/**
 * Download a YouTube playlist using yt-dlp
 */
export async function downloadYouTubePlaylist(
  url: string,
  outputDir: string,
  options: YouTubeDownloadOptions = {}
): Promise<YouTubeDownloadResult> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [
    '-o',
    path.join(outputDir, '%(playlist_title)s/%(title)s.%(ext)s'),
    '--newline',
    '--progress',
    '--no-warnings',
    '--js-runtimes',
    'node',
  ];

  // Add cookie authentication if specified (with path traversal validation)
  if (options.cookiesFile) {
    validatePathBoundary(options.cookiesFile, process.cwd());
    args.push('--cookies', options.cookiesFile);
  }

  // Add quality/format options
  if (options.audioOnly) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (options.videoOnly) {
    args.push('-f', 'bestvideo[height<=1080]/bestvideo');
  } else if (options.quality) {
    if (options.quality === 'best') {
      args.push('-f', 'bestvideo+bestaudio/best');
    } else if (options.quality === 'worst') {
      args.push('-f', 'worst');
    } else {
      const res = options.quality.replace('p', '');
      args.push('-f', `bestvideo[height<=${res}]+bestaudio/best[height<=${res}]`);
    }
  } else {
    // Default: best quality up to 1080p
    args.push('-f', 'best[height<=1080]/best');
  }

  args.push(url);

  return new Promise((resolve) => {
    // If already aborted before spawning, resolve immediately
    if (options.signal?.aborted) {
      resolve({ success: false, error: 'Aborted' });
      return;
    }

    const ytdlp = spawn('yt-dlp', args);

    let lastOutput = '';
    let downloadedFilePath: string | undefined;

    // Listen for abort signal to kill the yt-dlp process
    const onAbort = () => {
      ytdlp.kill();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    ytdlp.stdout.on('data', (data: Buffer) => {
      const output = data.toString();
      lastOutput += output;

      // Parse progress from yt-dlp output
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch && options.onProgress) {
        const percent = parseFloat(progressMatch[1]);
        options.onProgress(percent);
      }

      // Extract destination file path
      const destMatch = output.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        downloadedFilePath = destMatch[1].trim();
      }

      // Extract file path for already downloaded files
      const alreadyDownloadedMatch = output.match(/\[download\] (.+) has already been downloaded/);
      if (alreadyDownloadedMatch) {
        downloadedFilePath = alreadyDownloadedMatch[1].trim();
      }
    });

    ytdlp.stderr.on('data', (data: Buffer) => {
      lastOutput += data.toString();
    });

    ytdlp.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort);

      // If aborted, resolve as failed/aborted regardless of exit code
      if (options.signal?.aborted) {
        resolve({ success: false, error: 'Aborted' });
        return;
      }

      const downloadedFiles = countDownloadedFiles(outputDir);

      if (code === 0 || downloadedFiles > 0) {
        resolve({
          success: true,
          filePath: downloadedFilePath || outputDir,
          filesCount: downloadedFiles,
        });
      } else {
        // Check if it's already downloaded
        if (lastOutput.includes('has already been downloaded') && downloadedFilePath) {
          resolve({
            success: true,
            filePath: downloadedFilePath,
          });
          return;
        }

        resolve({
          success: false,
          error: `yt-dlp exited with code ${code}: ${lastOutput.slice(-500)}`,
        });
      }
    });

    ytdlp.on('error', (error) => {
      options.signal?.removeEventListener('abort', onAbort);

      if (error.message?.includes('ENOENT')) {
        resolve({
          success: false,
          error:
            'yt-dlp not found. Please install yt-dlp: https://github.com/yt-dlp/yt-dlp#installation',
        });
      } else {
        resolve({
          success: false,
          error: error.message,
        });
      }
    });
  });
}

export interface PlaylistInfo {
  title: string;
  videoCount: number;
  uploader?: string;
  entries: Array<{ id: string; title: string; url: string }>;
}

/**
 * Get playlist info (video count, titles) without downloading
 */
export async function getPlaylistInfo(
  url: string,
  cookiesFile?: string
): Promise<PlaylistInfo | null> {
  const args = [
    '--flat-playlist',
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--js-runtimes',
    'node',
  ];
  if (cookiesFile) {
    validatePathBoundary(cookiesFile, process.cwd());
    args.push('--cookies', cookiesFile);
  }
  args.push(url);

  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', args);

    let output = '';

    ytdlp.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 && !output) {
        resolve(null);
        return;
      }

      try {
        // yt-dlp emits one JSON object per line (one per video)
        const lines = output.trim().split('\n').filter(Boolean);
        const entries: PlaylistInfo['entries'] = [];
        let title = '';
        let uploader = '';

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            entries.push({
              id: entry.id || '',
              title: entry.title || '',
              url: entry.url || entry.webpage_url || '',
            });
            // Playlist metadata is on each entry
            if (!title && entry.playlist_title) {
              title = entry.playlist_title;
            }
            if (!uploader && entry.playlist_uploader) {
              uploader = entry.playlist_uploader;
            }
          } catch {
            // Skip malformed lines
          }
        }

        if (entries.length === 0) {
          resolve(null);
          return;
        }

        resolve({
          title: title || 'Unknown Playlist',
          videoCount: entries.length,
          uploader: uploader || undefined,
          entries,
        });
      } catch {
        resolve(null);
      }
    });

    ytdlp.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Get video info without downloading
 */
export async function getVideoInfo(
  url: string,
  cookiesFile?: string
): Promise<{
  title?: string;
  duration?: number;
  uploader?: string;
  thumbnail?: string;
  formats?: Array<{ formatId: string; quality: string; ext: string }>;
} | null> {
  const args = ['--dump-json', '--no-download', '--no-warnings', '--js-runtimes', 'node'];
  if (cookiesFile) {
    validatePathBoundary(cookiesFile, process.cwd());
    args.push('--cookies', cookiesFile);
  }
  args.push(url);

  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', args);

    let output = '';

    ytdlp.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && output) {
        try {
          const info = JSON.parse(output);
          resolve({
            title: info.title,
            duration: info.duration,
            uploader: info.uploader,
            thumbnail: info.thumbnail,
            formats: info.formats?.map((f: any) => ({
              formatId: f.format_id,
              quality: f.quality,
              ext: f.ext,
            })),
          });
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    ytdlp.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Get estimated file size for a YouTube video without downloading.
 * Returns bytes or null if unavailable.
 */
export async function getVideoFileSize(url: string, cookiesFile?: string): Promise<number | null> {
  const args = ['--dump-json', '--no-download', '--no-warnings', '--js-runtimes', 'node'];
  if (cookiesFile) {
    validatePathBoundary(cookiesFile, process.cwd());
    args.push('--cookies', cookiesFile);
  }
  args.push(url);

  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', args);
    let output = '';

    ytdlp.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && output) {
        try {
          const info = JSON.parse(output);
          // Try filesize_approx first (available on most videos), then filesize
          const size = info.filesize_approx ?? info.filesize ?? null;
          if (typeof size === 'number' && size > 0) {
            resolve(size);
          } else {
            // Try to get size from the selected format entry
            const fmt = info.requested_formats?.[0] || info.format;
            const fmtSize = fmt?.filesize_approx ?? fmt?.filesize ?? null;
            resolve(typeof fmtSize === 'number' && fmtSize > 0 ? fmtSize : null);
          }
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    ytdlp.on('error', () => {
      resolve(null);
    });
  });
}
