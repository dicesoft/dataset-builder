/**
 * SerpAPI providers — Google, Google Images, Bing, DuckDuckGo, Google Scholar
 * Single API key (serpApiKey) powers all five engines via serpapi.com
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { getConfig } from '../../../config';

/** Pagination info from SerpAPI responses */
interface SerpApiPagination {
  next?: string;
}

/** An organic search result from SerpAPI */
interface SerpApiOrganicResult {
  link?: string;
  title?: string;
  snippet?: string;
}

/** An inline video result from SerpAPI */
interface SerpApiInlineVideo {
  link?: string;
  title?: string;
}

/** An image result from SerpAPI Google Images */
interface SerpApiImageResult {
  original?: string;
  title?: string;
  link?: string;
  thumbnail?: string;
  original_width?: number;
  original_height?: number;
}

/** A Google Scholar author entry */
interface SerpApiScholarAuthor {
  name: string;
}

/** A Google Scholar result from SerpAPI */
interface SerpApiScholarResult {
  link?: string;
  title?: string;
  snippet?: string;
  publication_info?: {
    authors?: SerpApiScholarAuthor[];
    summary?: string;
  };
  inline_links?: {
    cited_by?: { total?: number };
  };
  resources?: Array<{ link?: string }>;
}

/** Common SerpAPI response shape */
interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  inline_videos?: SerpApiInlineVideo[];
  images_results?: SerpApiImageResult[];
  serpapi_pagination?: SerpApiPagination;
}

/**
 * Shared fetch helper for all SerpAPI engines.
 * Automatically includes `location` param when `searchLocation` is configured.
 */
async function serpApiFetch(params: Record<string, string>): Promise<SerpApiResponse> {
  const config = getConfig();
  const apiKey = config.get('serpApiKey') as string | undefined;
  if (!apiKey) throw new Error('serpApiKey not configured');

  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Add location if configured (SerpAPI ignores it for engines that don't support it)
  const location = config.get('searchLocation');
  if (location) url.searchParams.set('location', location);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    let detail = '';
    try {
      detail = JSON.parse(text)?.error || '';
    } catch {}
    throw new Error(`SerpAPI error ${response.status}: ${detail || text.slice(0, 200)}`);
  }
  return response.json() as Promise<SerpApiResponse>;
}

// ─── Google Web ──────────────────────────────────────────────────────────────

export class SerpApiGoogleProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'serpapi-google',
    name: 'SerpAPI Google',
    category: 'web',
    requiresApiKey: true,
    apiKeyConfigName: 'serpApiKey',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return !!getConfig().get('serpApiKey');
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    try {
      let start = 0;
      while (results.length < limit) {
        const data = await serpApiFetch({
          engine: 'google',
          q: query,
          num: String(Math.min(limit - results.length, 10)),
          start: String(start),
        });

        let newCount = 0;

        // Collect from organic_results
        const organicItems: SerpApiOrganicResult[] = data.organic_results || [];
        for (const item of organicItems) {
          if (results.length >= limit) break;
          if (item.link && item.title && !seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            results.push({
              url: item.link,
              title: item.title,
              snippet: item.snippet || '',
            });
            newCount++;
          }
        }

        // Also collect from inline_videos (have link and title fields)
        const inlineVideos: SerpApiInlineVideo[] = data.inline_videos || [];
        for (const item of inlineVideos) {
          if (results.length >= limit) break;
          if (item.link && item.title && !seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            results.push({
              url: item.link,
              title: item.title,
              snippet: '',
            });
            newCount++;
          }
        }

        // Stop if no new unique results on this page
        if (newCount === 0) break;

        start += 10;

        // Use serpapi_pagination to determine if more pages exist
        if (!data.serpapi_pagination?.next) break;
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      this.log(`Error: ${error}`);
    }

    return this.tagResults(results);
  }
}

// ─── Google Images ───────────────────────────────────────────────────────────

export class SerpApiGoogleImagesProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'serpapi-google-images',
    name: 'SerpAPI Google Images',
    category: 'images',
    requiresApiKey: true,
    apiKeyConfigName: 'serpApiKey',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return !!getConfig().get('serpApiKey');
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    try {
      let ijn = 0;
      while (results.length < limit) {
        const data = await serpApiFetch({
          engine: 'google_images',
          q: query,
          ijn: String(ijn),
        });

        const items: SerpApiImageResult[] = data.images_results || [];
        if (items.length === 0) break;

        let newCount = 0;
        for (const item of items) {
          if (results.length >= limit) break;
          if (item.original && item.title && !seenUrls.has(item.original)) {
            seenUrls.add(item.original);
            results.push({
              url: item.original,
              title: item.title,
              snippet: '',
              metadata: {
                sourceUrl: item.link,
                thumbnailUrl: item.thumbnail,
                width: item.original_width,
                height: item.original_height,
              },
            });
            newCount++;
          }
        }

        if (newCount === 0) break;

        ijn++;
        if (items.length < 100) break; // Google Images returns ~100 per page
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      this.log(`Error: ${error}`);
    }

    return this.tagResults(results);
  }
}

// ─── Bing ────────────────────────────────────────────────────────────────────

export class SerpApiBingProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'serpapi-bing',
    name: 'SerpAPI Bing',
    category: 'web',
    requiresApiKey: true,
    apiKeyConfigName: 'serpApiKey',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return !!getConfig().get('serpApiKey');
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    try {
      let first = 1;
      while (results.length < limit) {
        const data = await serpApiFetch({
          engine: 'bing',
          q: query,
          count: String(Math.min(limit - results.length, 10)),
          first: String(first),
        });

        const items = (data.organic_results || []) as SerpApiOrganicResult[];
        if (items.length === 0) break;

        let newCount = 0;
        for (const item of items) {
          if (results.length >= limit) break;
          if (item.link && item.title && !seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            results.push({
              url: item.link,
              title: item.title,
              snippet: item.snippet || '',
            });
            newCount++;
          }
        }

        // No new unique results — exhausted unique results
        if (newCount === 0) break;

        first += 10;

        // Use serpapi_pagination to determine if more pages exist
        if (!data.serpapi_pagination?.next) break;
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      this.log(`Error: ${error}`);
    }

    return this.tagResults(results);
  }
}

// ─── DuckDuckGo ──────────────────────────────────────────────────────────────

export class SerpApiDuckDuckGoProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'serpapi-duckduckgo',
    name: 'SerpAPI DuckDuckGo',
    category: 'web',
    requiresApiKey: true,
    apiKeyConfigName: 'serpApiKey',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return !!getConfig().get('serpApiKey');
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    try {
      let start = 0;
      while (results.length < limit) {
        const params: Record<string, string> = {
          engine: 'duckduckgo',
          q: query,
        };
        if (start > 0) params.start = String(start);

        const data = await serpApiFetch(params);

        const items = (data.organic_results || []) as SerpApiOrganicResult[];
        if (items.length === 0) break;

        let newCount = 0;
        for (const item of items) {
          if (results.length >= limit) break;
          if (item.link && item.title && !seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            results.push({
              url: item.link,
              title: item.title,
              snippet: item.snippet || '',
            });
            newCount++;
          }
        }

        if (newCount === 0) break;

        start += items.length;

        if (!data.serpapi_pagination?.next) break;
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      this.log(`Error: ${error}`);
    }

    return this.tagResults(results);
  }
}

// ─── Google Scholar ──────────────────────────────────────────────────────────

export class SerpApiGoogleScholarProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'serpapi-google-scholar',
    name: 'SerpAPI Google Scholar',
    category: 'academic',
    requiresApiKey: true,
    apiKeyConfigName: 'serpApiKey',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return !!getConfig().get('serpApiKey');
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const seenUrls = new Set<string>();

    try {
      let start = 0;
      while (results.length < limit) {
        const data = await serpApiFetch({
          engine: 'google_scholar',
          q: query,
          num: String(Math.min(limit - results.length, 10)),
          start: String(start),
        });

        const items = (data.organic_results || []) as SerpApiScholarResult[];
        if (items.length === 0) break;

        let newCount = 0;
        for (const item of items) {
          if (results.length >= limit) break;
          const url = item.link || '';
          if (item.title && !seenUrls.has(url)) {
            seenUrls.add(url);
            const authors = item.publication_info?.authors?.map((a) => a.name)?.join(', ');

            results.push({
              url,
              title: item.title,
              snippet: item.snippet || '',
              metadata: {
                authors: authors || item.publication_info?.summary,
                citedBy: item.inline_links?.cited_by?.total,
                year: item.publication_info?.summary?.match(/\b(19|20)\d{2}\b/)?.[0],
                pdfUrl: item.resources?.[0]?.link,
              },
            });
            newCount++;
          }
        }

        if (newCount === 0) break;

        start += 10;

        if (!data.serpapi_pagination?.next) break;
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      this.log(`Error: ${error}`);
    }

    return this.tagResults(results);
  }
}
