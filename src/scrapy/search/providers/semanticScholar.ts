/**
 * Semantic Scholar Search Provider — REST API
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';

export class SemanticScholarSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'semantic-scholar',
    name: 'Semantic Scholar',
    category: 'academic',
    requiresApiKey: false,
    apiKeyConfigName: 'semanticScholarApiKey',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,abstract,url,citationCount,year,venue`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      const apiKey = this.getApiKey();
      if (apiKey) {
        headers['x-api-key'] = apiKey;
        this.log('Using API key for higher rate limits');
      }

      const response = await fetch(searchUrl, { headers });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = (await response.json()) as {
        data?: Array<{
          url?: string;
          title?: string;
          abstract?: string;
          citationCount?: number;
          year?: number;
          venue?: string;
          paperId?: string;
        }>;
      };

      const papers = data?.data || [];
      this.log(`Got ${papers.length} raw results`);

      for (const paper of papers) {
        if (results.length >= limit) break;

        const url =
          paper.url ||
          (paper.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : '');
        const title = paper.title || '';
        const snippet = paper.abstract || '';

        if (url && title) {
          results.push({
            url,
            title,
            snippet,
            metadata: {
              citationCount: paper.citationCount,
              year: paper.year,
              venue: paper.venue,
            },
          });
        }
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('Semantic Scholar search error:', error);
    }

    return this.tagResults(results);
  }
}
