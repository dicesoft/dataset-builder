/**
 * Asset Manifest types for tracking downloaded files with metadata
 */

/**
 * Extended DownloadItem with page context for manifest tracking
 */
export interface DownloadItem {
  url: string;
  filename?: string;
  type: 'image' | 'video' | 'pdf' | 'pptx' | 'docx' | 'csv' | 'html' | 'text';
  index: number;
  sourceUrl?: string; // Source page URL for hotlink protection bypass
  // Page context fields for manifest
  sourcePageTitle?: string; // Title of the page where the link was found
  sourcePageId?: string; // ID of the source page entry
  altText?: string | null; // Alt text for images
  surroundingText?: string | null; // Text surrounding the link
  pageDepth?: number; // Depth of the page in the crawl
}

/**
 * Download progress tracking
 */
export interface DownloadProgress {
  index: number;
  url: string;
  filename: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'skipped';
  progress: number;
  bytesDownloaded: number;
  totalBytes?: number;
  error?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * YouTube download options
 */
export interface YouTubeOptions {
  quality?: string;
  audioOnly?: boolean;
  videoOnly?: boolean;
  cookiesFile?: string;
}

/**
 * Logger interface for download operations.
 * Compatible with DetailedLogger from utils/detailedLogger.
 */
export interface DownloadLogger {
  logDownloadAttempt(url: string, sourceUrl: string | undefined, attempt: number): void;
  logDownloadComplete(
    url: string,
    filePath: string,
    fileSize: number,
    duration: number,
    fileType: string
  ): void;
  logDownloadFailure(url: string, error: Error | string, attempt: number): void;
}

/**
 * Downloader configuration options
 */
export interface DownloaderOptions {
  concurrent?: number;
  ytConcurrent?: number;
  outputDir?: string;
  retry?: number;
  timeout?: number;
  verbose?: boolean;
  logger?: DownloadLogger;
  youtubeOptions?: YouTubeOptions;
}

/**
 * Context information for an asset
 */
export interface AssetContext {
  altText: string | null;
  surroundingText: string | null;
  pageDepth: number;
  tags: string[]; // Auto-extracted from URL + title
}

/**
 * Relevance information (populated by transform command)
 */
export interface AssetRelevance {
  score: number | null;
  matchesTarget: boolean | null;
  reason: string | null;
}

/**
 * Individual asset record in the manifest
 */
export interface AssetRecord {
  id: string; // "asset_0", "asset_1"
  sourceUrl: string; // Direct download URL
  sourcePageUrl: string; // Page where link was found
  sourcePageTitle: string; // Title of source page
  localPath: string; // "downloads/images/car_01.jpg"
  fileName: string; // "car_01.jpg"
  fileType: string; // "image" | "video" | "pdf" | etc.
  fileSize: number; // Bytes
  status: string; // "completed" | "failed" | "skipped"
  downloadedAt: string; // ISO timestamp
  duration: number; // Download duration ms
  context: AssetContext;
  relevance: AssetRelevance;
}

/**
 * Complete asset manifest for a download task
 */
export interface AssetManifest {
  taskId: string;
  searchQuery: string | null;
  generatedAt: string; // ISO timestamp
  totalAssets: number;
  version: string; // Manifest format version
  assets: AssetRecord[];
}
