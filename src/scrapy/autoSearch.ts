/**
 * Auto-search module — Thin facade over the modular search provider system.
 * Maintains backward compatibility with the original API.
 */

import * as cheerio from 'cheerio';
import { verboseLog } from '../utils/logger';
import { ensureProviders, searchSingle, searchMulti } from './search/registry';
import type { DedupResult } from './search/dedup';

// Re-export SearchResult from the new module for backward compatibility
export type { SearchResult } from './search/types';
export type { DedupResult } from './search/dedup';

/** Legacy provider type — kept for backward compat */
export type SearchProvider =
  | 'google'
  | 'bing'
  | 'duckduckgo'
  | 'brave'
  | 'ollama'
  | 'youtube'
  // New providers
  | 'reddit'
  | 'arxiv'
  | 'google-scholar'
  | 'semantic-scholar'
  | 'sketchfab'
  | 'google-images'
  | 'bing-images'
  | 'github'
  | 'twitter'
  | 'facebook'
  | 'instagram';

/**
 * Search for URLs using search engines (backward-compatible entry point).
 * Supports both single provider (legacy) and comma-separated multi-provider usage.
 */
export async function search(
  query: string,
  limit: number = 10,
  provider: SearchProvider | string = 'duckduckgo'
): Promise<DedupResult> {
  await ensureProviders();

  verboseLog(`Starting search for query: "${query}"`);
  verboseLog(`Provider: ${provider}, Limit: ${limit}`);

  // Support comma-separated providers
  const providerIds = provider
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (providerIds.length > 1) {
    return searchMulti(query, limit, providerIds);
  }

  return searchSingle(query, limit, providerIds[0]);
}

/**
 * Extract URLs from a page
 */
export async function extractUrls(url: string): Promise<string[]> {
  const urls: string[] = [];

  verboseLog(`Extracting URLs from: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      verboseLog(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.startsWith('http') || href.startsWith('//'))) {
        const fullUrl = href.startsWith('//') ? 'https:' + href : href;
        if (!urls.includes(fullUrl)) {
          urls.push(fullUrl);
        }
      }
    });

    verboseLog(`Extracted ${urls.length} URLs from ${url}`);
  } catch (error) {
    console.error(`Error extracting URLs from ${url}:`, error);
    verboseLog(`Error details: ${error instanceof Error ? error.message : String(error)}`);
  }

  return urls;
}
