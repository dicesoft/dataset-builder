/**
 * DuckDuckGo Search Provider — HTML scraping
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, trySelectors, DEFAULT_HEADERS } from '../utils';

export class DuckDuckGoSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    category: 'web',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
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
      this.log(`Response size: ${html.length} bytes`);

      const blockCheck = detectAntiBot(html);
      if (blockCheck.isBlocked) {
        console.warn(`DuckDuckGo search blocked: ${blockCheck.reason}`);
        return [];
      }

      const $ = cheerio.load(html);
      const selectors = [
        'div.result',
        'article.result',
        '.web-result',
        'div[data-testid="result"]',
        '.results > div',
        '.result',
      ];
      const elements = trySelectors($, selectors);
      if (!elements) return [];

      elements.each((_: number, el: any) => {
        if (results.length >= limit) return false;
        const $el = $(el);

        let $a = $el.find('a.result__a').first();
        if (!$a.length) $a = $el.find('h2 a').first();
        if (!$a.length) $a = $el.find('a[href^="http"]').first();
        if (!$a.length) $a = $el.find('a').first();

        const url = $a.attr('href') || '';
        const title = $a.text().trim();

        let snippet = '';
        for (const sel of [
          'a.result__snippet',
          'div.result__snippet',
          '.result__snippet',
          '.web-result__snippet',
          'div[class*="snippet"]',
          'p',
        ]) {
          snippet = $el.find(sel).text().trim();
          if (snippet) break;
        }

        if (url.startsWith('http') && results.length < limit) {
          results.push({ url, title, snippet });
        }
      });

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('DuckDuckGo search error:', error);
    }

    return this.tagResults(results);
  }
}
