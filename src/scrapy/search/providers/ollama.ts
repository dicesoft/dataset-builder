/**
 * Ollama Web Search Provider — API-based with DuckDuckGo fallback
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { getConfig } from '../../../config';

export class OllamaSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'ollama',
    name: 'Ollama Web Search',
    category: 'web',
    requiresApiKey: true,
    apiKeyConfigName: 'ollamaApiKey',
    hasFallback: true,
  };

  isAvailable(): boolean {
    return true; // Falls back to DuckDuckGo
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const config = getConfig();
    const ollamaKey = config.get('ollamaApiKey');

    if (!ollamaKey) {
      this.log('No API key, falling back to DuckDuckGo');
      const { DuckDuckGoSearchProvider } = await import('./duckduckgo');
      const ddg = new DuckDuckGoSearchProvider();
      return ddg.search(query, limit);
    }

    return this.tagResults(await this.searchApi(query, limit, ollamaKey));
  }

  private async searchApi(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const maxResultsPerRequest = 10;
    let offset = 0;

    try {
      while (results.length < limit) {
        const remaining = limit - results.length;
        const num = Math.min(remaining, maxResultsPerRequest);

        this.log(`API request: max_results=${num}, offset=${offset}`);

        const response = await fetch('https://ollama.com/api/web_search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query, max_results: num, offset }),
        });

        if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);

        const data = (await response.json()) as {
          results?: Array<{ title: string; url: string; content?: string }>;
        };

        const webResults = data.results || [];
        this.log(`API returned ${webResults.length} results (offset: ${offset})`);

        for (const item of webResults) {
          if (item.url && item.title && results.length < limit) {
            results.push({ url: item.url, title: item.title, snippet: item.content || '' });
          }
        }

        if (webResults.length < num) break;
        offset += maxResultsPerRequest;
        if (offset > 1000) break;
      }

      this.log(`Completed: ${results.length}/${limit} results`);
    } catch (error) {
      console.error('Ollama Web Search API error:', error);
    }

    return results;
  }
}
