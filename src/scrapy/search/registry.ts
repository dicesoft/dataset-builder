/**
 * Search provider registry — registration, lookup, and multi-source orchestration
 */

import { verboseLog } from '../../utils/logger';
import type { SearchProvider, SearchResult } from './types';
import { deduplicateAndRank, type DedupResult } from './dedup';

// Provider registry
const providers = new Map<string, SearchProvider>();

/**
 * Register a search provider
 */
export function registerProvider(provider: SearchProvider): void {
  providers.set(provider.config.id, provider);
}

/**
 * Get a provider by ID
 */
export function getProvider(id: string): SearchProvider | undefined {
  return providers.get(id);
}

/**
 * List all registered providers
 */
export function listProviders(): SearchProvider[] {
  return Array.from(providers.values());
}

/**
 * Search using a single provider by ID (backward-compatible)
 */
export async function searchSingle(
  query: string,
  limit: number,
  providerId: string
): Promise<DedupResult> {
  const provider = providers.get(providerId);
  if (!provider) {
    console.error(`Unknown search provider: ${providerId}`);
    return { results: [], totalBefore: 0, duplicatesRemoved: 0 };
  }
  const results = await provider.search(query, limit);
  return { results, totalBefore: results.length, duplicatesRemoved: 0 };
}

/**
 * Search across multiple providers in parallel, deduplicate, and rank results
 */
export async function searchMulti(
  query: string,
  limit: number,
  providerIds: string[]
): Promise<DedupResult> {
  if (providerIds.length === 0) {
    verboseLog('No providers specified for multi-search');
    return { results: [], totalBefore: 0, duplicatesRemoved: 0 };
  }

  // Single provider — no need for dedup overhead
  if (providerIds.length === 1) {
    return searchSingle(query, limit, providerIds[0]);
  }

  verboseLog(`Multi-source search across: ${providerIds.join(', ')}`);

  // Resolve providers
  const resolvedProviders: SearchProvider[] = [];
  for (const id of providerIds) {
    const provider = providers.get(id);
    if (!provider) {
      console.warn(`Unknown search provider: "${id}" — skipping`);
      continue;
    }
    if (!provider.isAvailable()) {
      console.warn(`Provider "${id}" is not available — skipping`);
      continue;
    }
    resolvedProviders.push(provider);
  }

  if (resolvedProviders.length === 0) {
    console.error('No available providers for multi-search');
    return { results: [], totalBefore: 0, duplicatesRemoved: 0 };
  }

  // Each provider gets the full count — dedup handles cross-provider overlap
  const settled = await Promise.allSettled(resolvedProviders.map((p) => p.search(query, limit)));

  // Collect all results
  const allResults: SearchResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const providerId = resolvedProviders[i].config.id;

    if (outcome.status === 'fulfilled') {
      verboseLog(`[${providerId}] returned ${outcome.value.length} results`);
      allResults.push(...outcome.value);
    } else {
      console.warn(`Provider "${providerId}" failed: ${outcome.reason}`);
    }
  }

  // Deduplicate and rank
  return deduplicateAndRank(allResults);
}

/**
 * Register all built-in providers
 */
export async function registerBuiltinProviders(): Promise<void> {
  const { GoogleSearchProvider } = await import('./providers/google');
  const { BingSearchProvider } = await import('./providers/bing');
  const { DuckDuckGoSearchProvider } = await import('./providers/duckduckgo');
  const { BraveSearchProvider } = await import('./providers/brave');
  const { OllamaSearchProvider } = await import('./providers/ollama');
  const { YouTubeSearchProvider } = await import('./providers/youtube');

  registerProvider(new GoogleSearchProvider());
  registerProvider(new BingSearchProvider());
  registerProvider(new DuckDuckGoSearchProvider());
  registerProvider(new BraveSearchProvider());
  registerProvider(new OllamaSearchProvider());
  registerProvider(new YouTubeSearchProvider());

  // Phase 4: Free specialized providers
  const { RedditSearchProvider } = await import('./providers/reddit');
  const { ArxivSearchProvider } = await import('./providers/arxiv');
  const { GoogleScholarSearchProvider } = await import('./providers/googleScholar');
  const { SemanticScholarSearchProvider } = await import('./providers/semanticScholar');
  const { SketchfabSearchProvider } = await import('./providers/sketchfab');

  registerProvider(new RedditSearchProvider());
  registerProvider(new ArxivSearchProvider());
  registerProvider(new GoogleScholarSearchProvider());
  registerProvider(new SemanticScholarSearchProvider());
  registerProvider(new SketchfabSearchProvider());

  // Phase 5: API-key / extended providers
  const { GoogleImagesSearchProvider } = await import('./providers/googleImages');
  const { BingImagesSearchProvider } = await import('./providers/bingImages');
  const { GitHubSearchProvider } = await import('./providers/github');

  registerProvider(new GoogleImagesSearchProvider());
  registerProvider(new BingImagesSearchProvider());
  registerProvider(new GitHubSearchProvider());

  // Phase 6: Social media providers
  const { TwitterSearchProvider } = await import('./providers/twitter');
  const { FacebookSearchProvider } = await import('./providers/facebook');
  const { InstagramSearchProvider } = await import('./providers/instagram');

  registerProvider(new TwitterSearchProvider());
  registerProvider(new FacebookSearchProvider());
  registerProvider(new InstagramSearchProvider());

  // Phase 7: SerpAPI providers (requires serpApiKey)
  const {
    SerpApiGoogleProvider,
    SerpApiGoogleImagesProvider,
    SerpApiBingProvider,
    SerpApiDuckDuckGoProvider,
    SerpApiGoogleScholarProvider,
  } = await import('./providers/serpapi');
  registerProvider(new SerpApiGoogleProvider());
  registerProvider(new SerpApiGoogleImagesProvider());
  registerProvider(new SerpApiBingProvider());
  registerProvider(new SerpApiDuckDuckGoProvider());
  registerProvider(new SerpApiGoogleScholarProvider());
}

// Track initialization
let initialized = false;

/**
 * Ensure all providers are registered (idempotent)
 */
export async function ensureProviders(): Promise<void> {
  if (initialized) return;
  await registerBuiltinProviders();
  initialized = true;
}
