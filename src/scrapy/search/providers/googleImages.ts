/**
 * Google Images Search Provider — Google CSE Image API + HTML scraping fallback
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, DEFAULT_HEADERS } from '../utils';
import { getConfig } from '../../../config';
import { verboseLog } from '../../../utils/logger';

export class GoogleImagesSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'google-images',
    name: 'Google Images',
    category: 'images',
    requiresApiKey: false,
    apiKeyConfigName: 'googleApiKey',
    hasFallback: true,
  };

  isAvailable(): boolean {
    return true; // Always available via HTML scraping fallback
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const config = getConfig();
    const googleKey = config.get('googleApiKey');
    const engineId = config.get('googleSearchEngineId');

    let results: SearchResult[];
    if (googleKey && engineId) {
      this.log('Using Google Custom Search API (image mode)');
      results = await this.searchApi(query, limit, googleKey, engineId);
    } else {
      this.log('No API key, falling back to HTML scraping');
      results = await this.searchHtml(query, limit);
    }

    return this.tagResults(results);
  }

  private async searchApi(
    query: string,
    limit: number,
    apiKey: string,
    searchEngineId: string
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const maxResultsPerRequest = 10;
    let startIndex = 1;

    try {
      while (results.length < limit) {
        const remaining = limit - results.length;
        const num = Math.min(remaining, maxResultsPerRequest);

        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('searchType', 'image');
        url.searchParams.set('key', apiKey);
        url.searchParams.set('cx', searchEngineId);
        url.searchParams.set('q', query);
        url.searchParams.set('num', num.toString());
        url.searchParams.set('start', startIndex.toString());

        const response = await fetch(url.toString());

        if (!response.ok) {
          const errorText = await response.text();
          verboseLog(`Google Images API error: ${response.status} ${errorText}`);
          throw new Error(`Google Images API error: ${response.status}`);
        }

        const data = (await response.json()) as {
          items?: Array<{
            link: string;
            title: string;
            snippet?: string;
            image?: {
              thumbnailLink?: string;
              width?: number;
              height?: number;
            };
          }>;
        };

        const items = data.items || [];
        for (const item of items) {
          if (item.link && item.title) {
            results.push({
              url: item.link,
              title: item.title,
              snippet: item.snippet || '',
              metadata: {
                thumbnailUrl: item.image?.thumbnailLink,
                width: item.image?.width,
                height: item.image?.height,
              },
            });
          }
        }

        this.log(`Google Images API returned ${items.length} results (startIndex: ${startIndex})`);
        if (items.length < num) break;
        startIndex += num;
        if (startIndex > 100) break;
      }
    } catch (error) {
      console.error('Google Images API error:', error);
    }

    return results;
  }

  private async searchHtml(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
      this.log(`Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const html = await response.text();
      this.log(`Response size: ${html.length} bytes`);

      const blockCheck = detectAntiBot(html);
      if (blockCheck.isBlocked) {
        console.warn(`Google Images search blocked: ${blockCheck.reason}`);
        return [];
      }

      const $ = cheerio.load(html);

      // Try to extract image data from embedded JSON in script tags
      const scripts = $('script').toArray();
      for (const script of scripts) {
        if (results.length >= limit) break;

        const scriptContent = $(script).html() || '';
        // Google embeds image data in AF_initDataCallback calls
        const jsonMatches = scriptContent.match(
          /\["(https?:\/\/[^"]+\.(jpg|jpeg|png|gif|webp|bmp|svg)[^"]*)"/gi
        );
        if (jsonMatches) {
          for (const match of jsonMatches) {
            if (results.length >= limit) break;
            const imageUrl = match.slice(2, -1); // Remove [" and "
            if (imageUrl.startsWith('http') && !imageUrl.includes('google.com')) {
              results.push({
                url: imageUrl,
                title: query,
                snippet: '',
                metadata: {
                  thumbnailUrl: undefined,
                  width: undefined,
                  height: undefined,
                },
              });
            }
          }
        }
      }

      // Fallback: parse image elements with data attributes
      if (results.length === 0) {
        $('img[data-src]').each((_: number, el: any) => {
          if (results.length >= limit) return false;
          const $el = $(el);
          const imageUrl = $el.attr('data-src') || $el.attr('src') || '';
          const title = $el.attr('alt') || query;

          if (imageUrl.startsWith('http') && !imageUrl.includes('google.com/images')) {
            results.push({
              url: imageUrl,
              title,
              snippet: '',
              metadata: {
                thumbnailUrl: undefined,
                width: undefined,
                height: undefined,
              },
            });
          }
        });
      }

      this.log(`Completed: ${results.length} results found`);
    } catch (error) {
      console.error('Google Images search error:', error);
    }

    return results;
  }
}
