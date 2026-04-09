/**
 * Asset Manifest utilities for tag extraction and manifest operations
 */

import { AssetManifest, AssetRecord } from './types';

/**
 * Extract meaningful tags from URL path segments and page title
 * Filters out common stop words and short tokens
 */
export function extractTags(pageTitle: string, url: string): string[] {
  const tags = new Set<string>();
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'over',
    'for',
    'of',
    'with',
    'by',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'can',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'my',
    'your',
    'his',
    'her',
    'its',
    'our',
    'their',
    'www',
    'com',
    'org',
    'net',
    'io',
    'co',
    'html',
    'htm',
    'php',
    'asp',
    'jsp',
    'index',
    'home',
    'page',
  ]);

  try {
    // Extract from URL path segments
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname
      .split('/')
      .filter((segment) => segment.length > 2)
      .map((segment) => {
        // Remove file extensions
        const withoutExt = segment.replace(/\.[^/.]+$/, '');
        // Split on common separators
        return withoutExt.split(/[-_\s]+/);
      })
      .flat();

    for (const segment of pathSegments) {
      const clean = segment.toLowerCase().trim();
      if (clean.length > 2 && !stopWords.has(clean) && /^[a-z0-9]+$/.test(clean)) {
        tags.add(clean);
      }
    }

    // Extract from hostname (domain parts)
    const hostParts = urlObj.hostname
      .split('.')
      .filter((part) => part.length > 2 && !stopWords.has(part.toLowerCase()));

    for (const part of hostParts) {
      const clean = part.toLowerCase().trim();
      if (clean.length > 2 && !stopWords.has(clean)) {
        tags.add(clean);
      }
    }
  } catch {
    // Invalid URL, skip URL-based tags
  }

  // Extract from page title
  if (pageTitle) {
    const titleWords = pageTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ') // Replace punctuation with spaces
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));

    for (const word of titleWords) {
      const clean = word.trim();
      if (clean.length > 2 && !stopWords.has(clean)) {
        tags.add(clean);
      }
    }
  }

  return Array.from(tags).sort();
}

/**
 * Generate asset ID from index
 * Returns "asset_0", "asset_1", etc.
 */
export function generateAssetId(index: number): string {
  return `asset_${index}`;
}

/**
 * Merge two manifests, with new manifest taking precedence for overlapping records
 * Uses sourceUrl as the unique key for merging
 */
export function mergeManifests(existing: AssetManifest, newManifest: AssetManifest): AssetManifest {
  // Create a map of existing assets by sourceUrl
  const assetMap = new Map<string, AssetRecord>();
  for (const asset of existing.assets) {
    assetMap.set(asset.sourceUrl, asset);
  }

  // Merge new assets, overwriting existing ones with same sourceUrl
  for (const asset of newManifest.assets) {
    assetMap.set(asset.sourceUrl, asset);
  }

  // Rebuild assets array with sorted IDs
  const mergedAssets = Array.from(assetMap.values()).map((asset, index) => ({
    ...asset,
    id: generateAssetId(index),
  }));

  return {
    taskId: existing.taskId,
    searchQuery: existing.searchQuery,
    generatedAt: new Date().toISOString(),
    totalAssets: mergedAssets.length,
    version: existing.version,
    assets: mergedAssets,
  };
}

/**
 * Create an empty asset manifest
 */
export function createEmptyManifest(
  taskId: string,
  searchQuery: string | null = null
): AssetManifest {
  return {
    taskId,
    searchQuery,
    generatedAt: new Date().toISOString(),
    totalAssets: 0,
    version: '1.0',
    assets: [],
  };
}

/**
 * Build an AssetRecord from download progress and context
 */
export function buildAssetRecord(
  progress: {
    url: string;
    filename: string;
    status: 'completed' | 'failed' | 'skipped';
    bytesDownloaded: number;
    startTime?: number;
    endTime?: number;
  },
  index: number,
  sourcePageUrl: string,
  sourcePageTitle: string,
  fileType: string,
  outputDir: string
): AssetRecord {
  const duration =
    progress.endTime && progress.startTime ? progress.endTime - progress.startTime : 0;

  // Calculate localPath relative to task folder
  const typeToSubdir: Record<string, string> = {
    image: 'downloads/images',
    video: 'downloads/videos',
    pdf: 'downloads/pdfs',
    docx: 'downloads/documents',
    pptx: 'downloads/documents',
    csv: 'downloads/csv',
    html: 'downloads/html',
    text: 'downloads/other',
  };

  const subdir = typeToSubdir[fileType] || 'downloads/other';
  const localPath = `${subdir}/${progress.filename}`;

  // Extract tags from page title and URL
  const tags = extractTags(sourcePageTitle, progress.url);

  return {
    id: generateAssetId(index),
    sourceUrl: progress.url,
    sourcePageUrl,
    sourcePageTitle: sourcePageTitle || 'Unknown',
    localPath,
    fileName: progress.filename,
    fileType,
    fileSize: progress.bytesDownloaded,
    status: progress.status,
    downloadedAt: new Date().toISOString(),
    duration,
    context: {
      altText: null,
      surroundingText: null,
      pageDepth: 0,
      tags,
    },
    relevance: {
      score: null,
      matchesTarget: null,
      reason: null,
    },
  };
}
