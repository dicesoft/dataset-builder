/**
 * arXiv Search Provider — Atom API
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';

export class ArxivSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'arxiv',
    name: 'arXiv',
    category: 'academic',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          Accept: 'application/atom+xml',
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const xml = await response.text();
      this.log(`Response size: ${xml.length} bytes`);

      const $ = cheerio.load(xml, { xmlMode: true });
      const entries = $('entry');
      this.log(`Found ${entries.length} entries`);

      entries.each((_: number, el: any) => {
        if (results.length >= limit) return false;

        const $entry = $(el);
        const title = $entry.find('title').text().trim().replace(/\s+/g, ' ');
        const summary = $entry.find('summary').text().trim().replace(/\s+/g, ' ');
        const published = $entry.find('published').text().trim();

        // Get the abstract page link (rel="alternate")
        let url = '';
        $entry.find('link').each((_: number, linkEl: any) => {
          const $link = $(linkEl);
          if ($link.attr('rel') === 'alternate') {
            url = $link.attr('href') || '';
          }
        });

        // Build PDF URL from the arxiv ID
        const id = $entry.find('id').text().trim();
        const pdfUrl = id ? id.replace('/abs/', '/pdf/') : '';

        // Collect authors
        const authors: string[] = [];
        $entry.find('author name').each((_: number, nameEl: any) => {
          const name = $(nameEl).text().trim();
          if (name) authors.push(name);
        });

        if (url && title) {
          results.push({
            url,
            title,
            snippet: summary,
            metadata: {
              authors,
              publishedDate: published,
              pdfUrl,
            },
          });
        }
      });

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('arXiv search error:', error);
    }

    return this.tagResults(results);
  }
}
