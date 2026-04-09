/**
 * Google Search Provider — HTML scraping + Custom Search API
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, trySelectors, DEFAULT_HEADERS } from '../utils';
import { getConfig } from '../../../config';
import { verboseLog } from '../../../utils/logger';

export class GoogleSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'google',
    name: 'Google',
    category: 'web',
    requiresApiKey: false,
    apiKeyConfigName: 'googleApiKey',
    hasFallback: true,
  };

  isAvailable(): boolean {
    return true; // Always available via HTML scraping
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const config = getConfig();
    const googleKey = config.get('googleApiKey');
    const engineId = config.get('googleSearchEngineId');

    let results: SearchResult[];
    if (googleKey && engineId) {
      this.log('Using Google Custom Search API');
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
        url.searchParams.set('key', apiKey);
        url.searchParams.set('cx', searchEngineId);
        url.searchParams.set('q', query);
        url.searchParams.set('num', num.toString());
        url.searchParams.set('start', startIndex.toString());

        const response = await fetch(url.toString());

        if (!response.ok) {
          const errorText = await response.text();
          verboseLog(`Google API error: ${response.status} ${errorText}`);
          throw new Error(`Google API error: ${response.status}`);
        }

        const data = (await response.json()) as {
          items?: Array<{ link: string; title: string; snippet?: string }>;
        };

        const items = data.items || [];
        for (const item of items) {
          if (item.link && item.title) {
            results.push({ url: item.link, title: item.title, snippet: item.snippet || '' });
          }
        }

        this.log(`Google API returned ${items.length} results (startIndex: ${startIndex})`);
        if (items.length < num) break;
        startIndex += num;
        if (startIndex > 100) break;
      }
    } catch (error) {
      console.error('Google Custom Search API error:', error);
    }

    return results;
  }

  private async searchHtml(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
      this.log(`Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const html = await response.text();
      this.log(`Response size: ${html.length} bytes`);

      const blockCheck = detectAntiBot(html);
      if (blockCheck.isBlocked) {
        console.warn(`Google search blocked: ${blockCheck.reason}`);
        return [];
      }

      const $ = cheerio.load(html);

      const containerSelectors = [
        'div[data-hveid]',
        'div[data-ved]',
        'div.g',
        'div[data-sokoban-container]',
        '#search .g',
        '#rso > div',
      ];

      const elements = trySelectors($, containerSelectors);
      if (!elements) {
        this.log('No search result elements found');
        return [];
      }

      elements.each((_: number, el: any) => {
        if (results.length >= limit) return false;

        const $el = $(el);
        let $a = $el.find('a[href^="http"]').first();
        if (!$a.length) $a = $el.find('a').first();

        let url = $a.attr('href') || '';
        if (url.startsWith('/url?q=')) {
          url = url.replace('/url?q=', '').split('&')[0];
        }
        if (url.includes('%')) {
          try {
            url = decodeURIComponent(url);
          } catch {
            /* keep original */
          }
        }
        if (!url.startsWith('http')) return;

        let title = $el.find('h3').text().trim();
        if (!title) title = $a.text().trim();

        let snippet = '';
        const snippetSelectors = [
          'div[data-sncf]',
          'span.st',
          '.VwiC3b',
          '.s3v94d',
          'div[data-ved] > div > span',
        ];
        for (const sel of snippetSelectors) {
          snippet = $el.find(sel).text().trim();
          if (snippet) break;
        }

        if (url && results.length < limit) {
          results.push({ url, title, snippet });
        }
      });

      this.log(`Completed: ${results.length} results found`);
    } catch (error) {
      console.error('Google search error:', error);
    }

    return results;
  }
}
