/**
 * Google Scholar Search Provider — HTML scraping
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, DEFAULT_HEADERS } from '../utils';

export class GoogleScholarSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'google-scholar',
    name: 'Google Scholar',
    category: 'academic',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&num=${limit}`;
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
        console.warn(`Google Scholar search blocked: ${blockCheck.reason}`);
        return [];
      }

      const $ = cheerio.load(html);
      const entries = $('div.gs_r div.gs_ri');
      this.log(`Found ${entries.length} result elements`);

      entries.each((_: number, el: any) => {
        if (results.length >= limit) return false;

        const $el = $(el);

        // Title and URL from h3 > a
        const $titleLink = $el.find('h3 a').first();
        const url = $titleLink.attr('href') || '';
        const title = $titleLink.text().trim();

        // Snippet from .gs_rs
        const snippet = $el.find('.gs_rs').text().trim();

        // Authors / year from .gs_a
        const authorLine = $el.find('.gs_a').text().trim();
        const authors = authorLine.split(' - ')[0]?.trim() || '';

        // Extract year (4-digit number) from author line
        const yearMatch = authorLine.match(/\b(19|20)\d{2}\b/);
        const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;

        // Citation count from .gs_fl "Cited by N"
        let citationCount: number | undefined;
        const flText = $el.find('.gs_fl').text();
        const citedMatch = flText.match(/Cited by (\d+)/);
        if (citedMatch) {
          citationCount = parseInt(citedMatch[1], 10);
        }

        // PDF link from sidebar (.gs_ggsd a)
        const pdfUrl = $el.closest('.gs_r').find('.gs_ggsd a').attr('href') || undefined;

        if (url && title) {
          results.push({
            url,
            title,
            snippet,
            metadata: {
              authors,
              citationCount,
              year,
              pdfUrl,
            },
          });
        }
      });

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('Google Scholar search error:', error);
    }

    return this.tagResults(results);
  }
}
