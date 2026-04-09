/**
 * Bing Search Provider — HTML scraping + Bing Web Search API
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, trySelectors, DEFAULT_HEADERS } from '../utils';
import { getConfig } from '../../../config';
import { verboseLog } from '../../../utils/logger';

export class BingSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'bing',
    name: 'Bing',
    category: 'web',
    requiresApiKey: false,
    apiKeyConfigName: 'bingApiKey',
    hasFallback: true,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const config = getConfig();
    const bingKey = config.get('bingApiKey');

    let results: SearchResult[];
    if (bingKey) {
      this.log('Using Bing Web Search API');
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
        `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`,
        { headers: { 'Ocp-Apim-Subscription-Key': apiKey } }
      );

      if (!response.ok) {
        throw new Error(`Bing API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        webPages?: { value?: Array<{ url: string; name: string; snippet?: string }> };
      };

      for (const item of (data.webPages?.value || []).slice(0, limit)) {
        if (item.url && item.name) {
          results.push({ url: item.url, title: item.name, snippet: item.snippet || '' });
        }
      }

      this.log(`API completed: ${results.length} results`);
    } catch (error) {
      console.error('Bing Search API error:', error);
    }

    return results;
  }

  private async searchHtml(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`;
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
        console.warn(`Bing search blocked: ${blockCheck.reason}`);
        return [];
      }

      const $ = cheerio.load(html);
      const selectors = ['li.b_algo', '.b_algo', '[data-bm]', '#b_results > li', '.b_results > li'];
      const elements = trySelectors($, selectors);
      if (!elements) return [];

      elements.each((_: number, el: any) => {
        if (results.length >= limit) return false;
        const $el = $(el);
        const $a = $el.find('a').first();
        const url = $a.attr('href') || '';
        const title = $a.text().trim();

        let snippet = '';
        for (const sel of ['p', '.b_caption p', '.b_snippet', '[class*="snippet"]']) {
          snippet = $el.find(sel).text().trim();
          if (snippet) break;
        }

        if (url.startsWith('http') && results.length < limit) {
          results.push({ url, title, snippet });
        }
      });

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('Bing search error:', error);
    }

    return results;
  }
}
