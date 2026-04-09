/**
 * File type handlers for downloading different file formats
 */

import fs from 'fs';
import path from 'path';
import {
  isYouTubeUrl,
  isYouTubePlaylist,
  downloadYouTubeVideo,
  downloadYouTubePlaylist,
  YouTubeDownloadOptions,
} from './videoHandler';

/** Realistic User-Agent strings for rotation */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

/** Get random User-Agent */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Get browser-like headers for a request */
function getRequestHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    DNT: '1',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  };

  if (referer) {
    headers['Referer'] = referer;
  }

  return headers;
}

/** Delay helper for retries */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FileType =
  | 'image'
  | 'video'
  | 'pdf'
  | 'pptx'
  | 'docx'
  | 'csv'
  | 'html'
  | 'text'
  | 'unknown';

/**
 * Handle file download with type-specific processing
 */
export async function handleFileDownload(
  url: string,
  outputPath: string,
  type: string,
  onProgress?: (bytes: number, total?: number) => void,
  timeout: number = 30000,
  retryCount: number = 0,
  sourceUrl?: string, // Source page URL for hotlink protection bypass
  youtubeOptions?: Omit<YouTubeDownloadOptions, 'onProgress'>,
  signal?: AbortSignal
): Promise<string> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Early abort check
  if (signal?.aborted) throw new Error('Aborted');

  // Handle YouTube videos with yt-dlp
  if (isYouTubePlaylist(url)) {
    console.warn(
      `Warning: Playlist URL reached fileHandler directly (should have been expanded): ${url}`
    );
    const result = await downloadYouTubePlaylist(url, dir, {
      ...youtubeOptions,
      signal,
      onProgress: (percent) => {
        if (onProgress) {
          // Approximate bytes based on typical playlist size (500MB)
          const estimatedTotal = 500 * 1024 * 1024;
          onProgress(Math.round((percent / 100) * estimatedTotal), estimatedTotal);
        }
      },
    });

    if (result.success) {
      return result.filePath || outputPath;
    } else {
      throw new Error(result.error || 'YouTube playlist download failed');
    }
  } else if (isYouTubeUrl(url)) {
    const result = await downloadYouTubeVideo(url, dir, {
      ...youtubeOptions,
      signal,
      onProgress: (percent) => {
        if (onProgress) {
          // Approximate bytes based on typical video size (100MB)
          const estimatedTotal = 100 * 1024 * 1024;
          onProgress(Math.round((percent / 100) * estimatedTotal), estimatedTotal);
        }
      },
    });

    if (result.success) {
      return result.filePath || outputPath;
    } else {
      throw new Error(result.error || 'YouTube download failed');
    }
  }

  // Try downloading with retries and header rotation
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    // Check abort before each retry attempt
    if (signal?.aborted) throw new Error('Aborted');

    try {
      return await downloadWithProgress(
        url,
        outputPath,
        type,
        onProgress,
        timeout,
        attempt,
        sourceUrl,
        signal
      );
    } catch (error: any) {
      // Don't retry if aborted
      if (signal?.aborted) throw new Error('Aborted');

      const is403 = error.message?.includes('403');
      const isLastAttempt = attempt >= retryCount;

      if (isLastAttempt) {
        throw error;
      }

      // Only apply backoff when retries are enabled
      if (retryCount > 0) {
        if (is403) {
          // Optimized backoff for 403: 500ms → 1s → 2s (max 2s) - quick retries with different headers
          const backoffMs = Math.min(500 * Math.pow(2, attempt), 2000);
          await delay(backoffMs);
        } else {
          // For non-403 errors, also retry with optimized backoff: 500ms → 1s → 1.5s (max 1.5s)
          const backoffMs = Math.min(500 * (attempt + 1), 1500);
          await delay(backoffMs);
        }
      }
    }
  }

  throw new Error(`Failed to download after ${retryCount} attempts`);
}

/** Download file with progress tracking */
async function downloadWithProgress(
  url: string,
  outputPath: string,
  type: string,
  onProgress?: (bytes: number, total?: number) => void,
  timeout: number = 30000,
  attempt: number = 0,
  sourceUrl?: string, // Source page URL for hotlink protection bypass
  signal?: AbortSignal
): Promise<string> {
  // Use source URL for referer if provided (bypasses hotlink protection), fallback to file URL host
  const referer =
    sourceUrl ||
    (() => {
      try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.hostname}/`;
      } catch {
        return undefined;
      }
    })();

  // Combine user-cancel signal with timeout signal
  const signals: AbortSignal[] = [];
  if (timeout) signals.push(AbortSignal.timeout(timeout));
  if (signal) signals.push(signal);
  const combinedSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

  const response = await fetch(url, {
    headers: getRequestHeaders(referer),
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : undefined;

  if (response.body) {
    const fileStream = fs.createWriteStream(outputPath);
    let streamError: Error | null = null;
    fileStream.on('error', (err) => {
      streamError = err;
    });
    let downloaded = 0;
    const reader = response.body.getReader();

    try {
      while (true) {
        if (streamError) throw streamError;
        const { done, value } = await reader.read();
        if (done) break;

        downloaded += value.length;
        fileStream.write(Buffer.from(value));
        if (onProgress) onProgress(downloaded, total);
      }
    } finally {
      fileStream.end();
    }
    if (streamError) throw streamError;
  }

  // Post-process based on type
  const contentType = response.headers.get('content-type') || undefined;
  await postProcessFile(outputPath, type as FileType, contentType);

  return outputPath;
}

/** Post-process downloaded file based on type */
async function postProcessFile(
  filePath: string,
  type: FileType,
  contentType?: string
): Promise<void> {
  // Skip validation if content-type doesn't match expected type (e.g., HTML served as image)
  if (contentType) {
    const typeMap: Record<FileType, string[]> = {
      image: ['image/'],
      video: ['video/'],
      pdf: ['application/pdf'],
      pptx: [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint',
      ],
      docx: [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
      ],
      csv: ['text/csv', 'application/csv'],
      html: ['text/html'],
      text: ['text/plain'],
      unknown: [],
    };

    const expectedTypes = typeMap[type];
    if (
      expectedTypes &&
      expectedTypes.length > 0 &&
      !expectedTypes.some((t) => contentType.includes(t))
    ) {
      console.warn(
        `Content-Type "${contentType}" doesn't match expected type "${type}", skipping validation`
      );
      return;
    }
  }

  try {
    switch (type) {
      case 'pdf':
        await validatePdf(filePath);
        break;
      case 'pptx':
      case 'docx':
        await validateZipStructure(filePath);
        break;
      case 'csv':
        await validateCsv(filePath);
        break;
      case 'image':
        await validateImage(filePath);
        break;
    }
  } catch (error) {
    console.warn(`Validation warning for ${path.basename(filePath)}: ${(error as Error).message}`);
    // Don't throw - allow the download to complete with a warning
  }
}

/** Validate PDF file */
async function validatePdf(filePath: string): Promise<void> {
  const buffer = Buffer.alloc(5);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 5, 0);
  fs.closeSync(fd);

  const header = buffer.toString('ascii');
  if (!header.startsWith('%PDF-')) {
    throw new Error('Invalid PDF file');
  }
}

/** Validate ZIP-based file (PPTX, DOCX) */
async function validateZipStructure(filePath: string): Promise<void> {
  const buffer = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  const isZip =
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (!isZip) {
    throw new Error('Invalid ZIP-based file');
  }
}

/** Validate CSV file */
async function validateCsv(filePath: string): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content || content.trim().length === 0) {
    throw new Error('Empty CSV file');
  }
}

/** Validate image file */
async function validateImage(filePath: string): Promise<void> {
  const buffer = Buffer.alloc(8);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 8, 0);
  fs.closeSync(fd);

  const signatures = [
    [0xff, 0xd8, 0xff], // JPEG
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0x47, 0x49, 0x46, 0x38], // GIF
    [0x52, 0x49, 0x46, 0x46], // WebP
    [0x42, 0x4d], // BMP
  ];

  const valid = signatures.some((sig) => sig.every((b, i) => buffer[i] === b));
  if (!valid && buffer[0] !== 0) {
    throw new Error('Invalid image file');
  }
}

/** Detect file type from URL or content-type */
export function detectFileType(url: string, contentType?: string): FileType {
  if (contentType) {
    if (contentType.includes('image')) return 'image';
    if (contentType.includes('video')) return 'video';
    if (contentType.includes('pdf')) return 'pdf';
    if (contentType.includes('powerpoint') || contentType.includes('pptx')) return 'pptx';
    if (contentType.includes('word') || contentType.includes('docx')) return 'docx';
    if (contentType.includes('csv')) return 'csv';
    if (contentType.includes('html')) return 'html';
    if (contentType.includes('text')) return 'text';
  }

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/.test(pathname)) return 'image';
    if (/\.(mp4|webm|avi|mov|mkv)$/.test(pathname)) return 'video';
    if (/\.pdf$/.test(pathname)) return 'pdf';
    if (/\.pptx?$/.test(pathname)) return 'pptx';
    if (/\.docx?$/.test(pathname)) return 'docx';
    if (/\.csv$/.test(pathname)) return 'csv';
    if (/\.html?$/.test(pathname)) return 'html';
    if (/\.txt$/.test(pathname)) return 'text';
  } catch {
    // Invalid URL
  }

  return 'unknown';
}
