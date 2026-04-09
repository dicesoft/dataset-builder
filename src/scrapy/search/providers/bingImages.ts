/**
 * Bing Images Search Provider — Bing Image Search API + HTML scraping fallback
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, DEFAULT_HEADERS } from '../utils';
import { getConfig } from '../../../config';

export class BingImagesSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'bing-images',
    name: 'Bing Images',
    category: 'images',
    requiresApiKey: false,
    apiKeyConfigName: 'bingApiKey',
    hasFallback: true,
  };

  isAvailable(): boolean {
    return true; // Always available via HTML scraping fallback
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const config = getConfig();
    const bingKey = config.get('bingApiKey');

    let results: SearchResult[];
    if (bingKey) {
      this.log('Using Bing Image Search API');
      results = await this.searchApi(query, limit, bingKey);
    } else {
      this.log('No API key, falling back to HTML scraping');
      results = await this.searchHtml(query, limit);
    }

    return this.tagResults(results);
  }

  private async searchApi(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      const response = await fetch(
        `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(query)}&count=${limit}`,
        { headers: { 'Ocp-Apim-Subscription-Key': apiKey } }
      );

      if (!response.ok) {
        throw new Error(`Bing Images API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        value?: Array<{
          contentUrl: string;
          name: string;
          description?: string;
          thumbnailUrl?: string;
          width?: number;
          height?: number;
        }>;
      };

      for (const item of (data.value || []).slice(0, limit)) {
        if (item.contentUrl && item.name) {
          results.push({
            url: item.contentUrl,
            title: item.name,
            snippet: item.description || '',
            metadata: {
              thumbnailUrl: item.thumbnailUrl,
              width: item.width,
              height: item.height,
            },
          });
        }
      }

      this.log(`API completed: ${results.length} results`);
    } catch (error) {
      console.error('Bing Images API error:', error);
    }

    return results;
  }

  private async searchHtml(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          ...DEFAULT_HEADERS,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const html = await response.text();
      const blockCheck = detectAntiBot(html);
      if (blockCheck.isBlocked) {
        console.warn(`Bing Images search blocked: ${blockCheck.reason}`);
        return [];
      }

      const $ = cheerio.load(html);

      // Bing image results are in anchor tags with class "iusc" or in data attributes
      $('a.iusc, a[class*="iusc"]').each((_: number, el: any) => {
        if (results.length >= limit) return false;

        const $el = $(el);
        const dataM = $el.attr('m') || '';

        try {
          // Bing embeds image metadata in a JSON "m" attribute
          const meta = JSON.parse(dataM) as {
            murl?: string;
            turl?: string;
            t?: string;
            desc?: string;
            mw?: number;
            mh?: number;
          };

          if (meta.murl) {
            results.push({
              url: meta.murl,
              title: meta.t || query,
              snippet: meta.desc || '',
              metadata: {
                thumbnailUrl: meta.turl,
                width: meta.mw,
                height: meta.mh,
              },
            });
          }
        } catch {
          // Skip elements with invalid JSON
        }
      });

      // Fallback: try img tags with src attributes
      if (results.length === 0) {
        $('img.mimg, img[class*="mimg"]').each((_: number, el: any) => {
          if (results.length >= limit) return false;
          const $el = $(el);
          const src = $el.attr('src') || $el.attr('data-src') || '';
          const alt = $el.attr('alt') || query;

          if (src.startsWith('http')) {
            results.push({
              url: src,
              title: alt,
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

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('Bing Images search error:', error);
    }

    return results;
  }
}
