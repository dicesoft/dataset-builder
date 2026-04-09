/**
 * URL deduplication and cross-provider result ranking
 */

import type { SearchResult } from './types';

export interface DedupResult {
  results: SearchResult[];
  totalBefore: number;
  duplicatesRemoved: number;
}

/**
 * Normalize a URL for deduplication: strip www, trailing slash, protocol differences
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let hostname = u.hostname.replace(/^www\./, '');
    let pathname = u.pathname.replace(/\/+$/, '') || '/';
    // Lowercase host and path
    return `${hostname.toLowerCase()}${pathname.toLowerCase()}${u.search}`;
  } catch {
    // If URL parsing fails, basic normalization
    return url
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

/**
 * Score boost for results appearing in multiple providers
 */
const MULTI_PROVIDER_BOOST = 0.15;

/**
 * Deduplicate and rank search results from multiple providers.
 *
 * - Groups results by normalized URL
 * - Boosts score for results appearing in multiple providers (+0.15 per extra provider)
 * - Sorts by score descending
 * - Returns all unique results (no hard cap) along with dedup stats
 */
export function deduplicateAndRank(results: SearchResult[]): DedupResult {
  const totalBefore = results.length;
  const urlMap = new Map<
    string,
    { result: SearchResult; providers: Set<string>; bestScore: number }
  >();

  for (const result of results) {
    const normalized = normalizeUrl(result.url);
    const existing = urlMap.get(normalized);

    if (existing) {
      // Track all providers that returned this URL
      if (result.provider) existing.providers.add(result.provider);
      // Keep the best score
      if ((result.score ?? 0) > existing.bestScore) {
        existing.bestScore = result.score ?? 0;
        // Merge: keep better title/snippet if available
        if (result.title.length > existing.result.title.length) {
          existing.result.title = result.title;
        }
        if (result.snippet.length > existing.result.snippet.length) {
          existing.result.snippet = result.snippet;
        }
      }
      // Merge metadata
      if (result.metadata) {
        existing.result.metadata = { ...existing.result.metadata, ...result.metadata };
      }
    } else {
      urlMap.set(normalized, {
        result: { ...result },
        providers: new Set(result.provider ? [result.provider] : []),
        bestScore: result.score ?? 0,
      });
    }
  }

  // Apply multi-provider boost and build final list
  const ranked: SearchResult[] = [];
  for (const { result, providers, bestScore } of urlMap.values()) {
    const extraProviders = Math.max(0, providers.size - 1);
    const boostedScore = bestScore + extraProviders * MULTI_PROVIDER_BOOST;
    ranked.push({
      ...result,
      score: Math.min(1, boostedScore),
      provider: providers.size > 1 ? Array.from(providers).join('+') : result.provider,
    });
  }

  // Sort by score descending, then by title length as tiebreaker
  ranked.sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.title.length - a.title.length;
  });

  return {
    results: ranked,
    totalBefore,
    duplicatesRemoved: totalBefore - ranked.length,
  };
}
