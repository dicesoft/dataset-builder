/**
 * Asset linker for connecting downloaded assets to scraped page data
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { AssetManifest, AssetRecord } from '../downloader/types';
import { ScrapedCombined, ScrapedPage } from './types';

/** Asset link result with page context */
export interface LinkedAsset {
  asset: AssetRecord;
  page: ScrapedPage | null;
  context: {
    pageText: string;
    pageTitle: string;
    surroundingText: string;
    relevanceHint: string;
  };
}

/**
 * Load asset manifest from file
 */
export async function loadManifest(manifestPath: string): Promise<AssetManifest> {
  const content = await readFile(manifestPath, 'utf-8');
  return JSON.parse(content) as AssetManifest;
}

/**
 * Load scraped combined data from file
 */
export async function loadScrapedData(scrapedPath: string): Promise<ScrapedCombined> {
  const content = await readFile(scrapedPath, 'utf-8');
  const parsed = JSON.parse(content);

  // Handle plain arrays as scraped data (format from scrape.ts)
  if (Array.isArray(parsed)) {
    return {
      taskId: path.basename(scrapedPath, '.json'),
      searchQuery: '',
      generatedAt: new Date().toISOString(),
      pages: parsed as ScrapedPage[],
    };
  }

  return parsed as ScrapedCombined;
}

/**
 * Link assets to their source pages
 */
export async function linkAssetsToPages(
  assets: AssetRecord[],
  pages: ScrapedPage[]
): Promise<LinkedAsset[]> {
  // Build page lookup map by URL
  const pageByUrl = new Map<string, ScrapedPage>();
  for (const page of pages) {
    pageByUrl.set(normalizeUrl(page.source_url), page);
  }

  const linked: LinkedAsset[] = [];

  for (const asset of assets) {
    // Find source page
    const sourceUrl = asset.sourcePageUrl;
    let page: ScrapedPage | null = pageByUrl.get(normalizeUrl(sourceUrl)) || null;

    // Try alternative URL formats if not found
    if (!page) {
      // Try without trailing slash
      const noSlash = sourceUrl.replace(/\/$/, '');
      page = pageByUrl.get(noSlash) || null;
    }

    if (!page) {
      // Try to find by partial match
      page = findPageByPartialMatch(sourceUrl, pages);
    }

    // Build context (convert undefined to null for consistency)
    const context = buildAssetContext(asset, page || null);

    linked.push({
      asset,
      page,
      context,
    });
  }

  return linked;
}

/**
 * Auto-detect and load input files from various sources
 */
export async function autoLoadInput(inputPath: string): Promise<{
  type: 'manifest' | 'scraped' | 'task-folder';
  manifest?: AssetManifest;
  scraped?: ScrapedCombined;
}> {
  const resolvedPath = path.resolve(inputPath);
  const stats = await import('fs/promises').then((fs) => fs.stat(resolvedPath));

  if (stats.isDirectory()) {
    // Task folder - look for both manifest and scraped data
    return await loadTaskFolder(resolvedPath);
  }

  // Single file - determine type
  const fileName = path.basename(resolvedPath).toLowerCase();

  if (fileName.includes('manifest') && fileName.endsWith('.json')) {
    return {
      type: 'manifest',
      manifest: await loadManifest(resolvedPath),
    };
  }

  if (fileName.includes('scraped') && fileName.endsWith('.json')) {
    const content = await readFile(resolvedPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Try to find a corresponding manifest in the parent directory
    const parentDir = path.dirname(resolvedPath);
    let manifest: AssetManifest | undefined;

    try {
      const fs = await import('fs/promises');
      const downloadsDir = path.join(parentDir, 'downloads');
      const downloadsFiles = await fs.readdir(downloadsDir);
      const manifestFile = downloadsFiles.find(
        (f) => f.toLowerCase().includes('manifest') && f.toLowerCase().endsWith('.json')
      );
      if (manifestFile) {
        manifest = await loadManifest(path.join(downloadsDir, manifestFile));
      }
    } catch {
      // No downloads directory or manifest not found
    }

    // Handle plain arrays as scraped data (format from scrape.ts)
    if (Array.isArray(parsed)) {
      return {
        type: manifest ? 'task-folder' : 'scraped',
        manifest,
        scraped: {
          taskId: path.basename(resolvedPath, '.json'),
          searchQuery: '',
          generatedAt: new Date().toISOString(),
          pages: parsed as ScrapedPage[],
        },
      };
    }

    // Standard ScrapedCombined format
    return {
      type: manifest ? 'task-folder' : 'scraped',
      manifest,
      scraped: parsed as ScrapedCombined,
    };
  }

  // Try to auto-detect from content
  const content = await readFile(resolvedPath, 'utf-8');
  const parsed = JSON.parse(content);

  // Handle plain arrays as scraped data (format from scrape.ts)
  if (Array.isArray(parsed)) {
    return {
      type: 'scraped',
      scraped: {
        taskId: path.basename(resolvedPath, '.json'),
        searchQuery: '',
        generatedAt: new Date().toISOString(),
        pages: parsed as ScrapedPage[],
      },
    };
  }

  if (parsed.assets && Array.isArray(parsed.assets)) {
    return {
      type: 'manifest',
      manifest: parsed as AssetManifest,
    };
  }

  if (parsed.pages && Array.isArray(parsed.pages)) {
    return {
      type: 'scraped',
      scraped: parsed as ScrapedCombined,
    };
  }

  throw new Error(
    `Cannot determine input type for ${inputPath}. Expected manifest or scraped data file.`
  );
}

/**
 * Load task folder with both manifest and scraped data
 */
async function loadTaskFolder(folderPath: string): Promise<{
  type: 'task-folder';
  manifest?: AssetManifest;
  scraped?: ScrapedCombined;
}> {
  const fs = await import('fs/promises');
  const files = await fs.readdir(folderPath);

  let manifest: AssetManifest | undefined;
  let scraped: ScrapedCombined | undefined;

  // Look for manifest in root folder
  const manifestFile = files.find(
    (f) => f.toLowerCase().includes('manifest') && f.toLowerCase().endsWith('.json')
  );
  if (manifestFile) {
    manifest = await loadManifest(path.join(folderPath, manifestFile));
  }

  // Look for manifest in downloads/ subdirectory
  if (!manifest) {
    const downloadsDir = path.join(folderPath, 'downloads');
    try {
      const downloadsFiles = await fs.readdir(downloadsDir);
      const downloadsManifestFile = downloadsFiles.find(
        (f) => f.toLowerCase().includes('manifest') && f.toLowerCase().endsWith('.json')
      );
      if (downloadsManifestFile) {
        manifest = await loadManifest(path.join(downloadsDir, downloadsManifestFile));
      }
    } catch {
      // No downloads directory or no manifest found
    }
  }

  // Look for scraped data
  const scrapedFile = files.find(
    (f) =>
      (f.toLowerCase().includes('scraped') && f.toLowerCase().endsWith('.json')) ||
      f === 'scraped_combined.json'
  );
  if (scrapedFile) {
    scraped = await loadScrapedData(path.join(folderPath, scrapedFile));
  }

  if (!manifest && !scraped) {
    // Try scraped/ subdirectory
    const scrapedDir = path.join(folderPath, 'scraped');
    try {
      const scrapedFiles = await fs.readdir(scrapedDir);
      const combinedFile = scrapedFiles.find((f) => f.endsWith('.json'));
      if (combinedFile) {
        scraped = await loadScrapedData(path.join(scrapedDir, combinedFile));
      }
    } catch {
      // No scraped directory
    }
  }

  if (!manifest && !scraped) {
    throw new Error(`No manifest or scraped data found in ${folderPath}`);
  }

  return {
    type: 'task-folder',
    manifest: manifest ? { ...manifest, assets: manifest.assets || [] } : undefined,
    scraped: scraped ? { ...scraped, pages: scraped.pages || [] } : undefined,
  };
}

/**
 * Build context for an asset
 */
function buildAssetContext(asset: AssetRecord, page: ScrapedPage | null): LinkedAsset['context'] {
  let pageText = '';
  let pageTitle = asset.sourcePageTitle || '';
  let surroundingText = asset.context.surroundingText || '';
  let relevanceHint = '';

  if (page) {
    pageText = page.text || '';
    pageTitle = page.title || pageTitle;

    // Extract text near asset reference
    if (asset.context.altText) {
      // Find text around alt text reference
      const altIndex = pageText.indexOf(asset.context.altText);
      if (altIndex >= 0) {
        const start = Math.max(0, altIndex - 200);
        const end = Math.min(pageText.length, altIndex + asset.context.altText.length + 200);
        surroundingText = pageText.slice(start, end);
      }
    }

    // Build relevance hint from page content
    relevanceHint = `${pageTitle} ${pageText.slice(0, 500)}`;
  }

  return {
    pageText,
    pageTitle,
    surroundingText,
    relevanceHint,
  };
}

/**
 * Find page by partial URL match
 */
function findPageByPartialMatch(sourceUrl: string, pages: ScrapedPage[]): ScrapedPage | null {
  // Extract domain and path
  try {
    const url = new URL(sourceUrl);
    const path = url.pathname;

    // Find page with matching path
    for (const page of pages) {
      try {
        const pageUrl = new URL(page.source_url);
        if (pageUrl.pathname === path) {
          return page;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Invalid URL, try simple string matching
    const domainMatch = sourceUrl.match(/https?:\/\/([^\/]+)/);
    if (domainMatch) {
      const domain = domainMatch[1];
      for (const page of pages) {
        if (page.source_url.includes(domain)) {
          return page;
        }
      }
    }
  }

  return null;
}

/**
 * Normalize URL for comparison
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, protocol, and www
    let normalized = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '');
    normalized = normalized.replace(/^www\./, '');
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, '');
  }
}

/**
 * Get asset file paths for vision processing
 */
export function getAssetPaths(
  assets: AssetRecord[],
  baseDir: string
): { id: string; path: string; record: AssetRecord }[] {
  return assets
    .filter((asset) => asset.status === 'completed' && asset.localPath)
    .map((asset) => ({
      id: asset.id,
      path: path.resolve(baseDir, asset.localPath),
      record: asset,
    }));
}

/**
 * Filter valid assets
 */
export function filterValidAssets(
  assets: AssetRecord[],
  typeFilter?: ('image' | 'video' | 'audio' | 'pdf')[]
): AssetRecord[] {
  return assets.filter((asset) => {
    // Must be completed
    if (asset.status !== 'completed') {
      return false;
    }

    // Must have local path
    if (!asset.localPath) {
      return false;
    }

    // Type filter
    if (typeFilter && typeFilter.length > 0) {
      const assetType = asset.fileType.toLowerCase();
      if (!typeFilter.some((t) => assetType.includes(t))) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Group assets by type
 */
export function groupAssetsByType(assets: AssetRecord[]): Map<string, AssetRecord[]> {
  const groups = new Map<string, AssetRecord[]>();

  for (const asset of assets) {
    const type = asset.fileType.toLowerCase();
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(asset);
  }

  return groups;
}

/**
 * Get asset by ID from manifest
 */
export function getAssetById(manifest: AssetManifest, id: string): AssetRecord | null {
  return manifest.assets.find((a) => a.id === id) || null;
}

/**
 * Search assets by tag
 */
export function findAssetsByTag(assets: AssetRecord[], tag: string): AssetRecord[] {
  const tagLower = tag.toLowerCase();
  return assets.filter((asset) =>
    asset.context.tags.some((t) => t.toLowerCase().includes(tagLower))
  );
}
