/**
 * Brave Search Provider — API-based with DuckDuckGo fallback
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { getConfig } from '../../../config';

export class BraveSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'brave',
    name: 'Brave Search',
    category: 'web',
    requiresApiKey: true,
    apiKeyConfigName: 'braveApiKey',
    hasFallback: true,
  };

  isAvailable(): boolean {
    return true; // Falls back to DuckDuckGo
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const config = getConfig();
    const braveKey = config.get('braveApiKey');

    if (!braveKey) {
      this.log('No API key, falling back to DuckDuckGo');
      // Import dynamically to avoid circular deps
      const { DuckDuckGoSearchProvider } = await import('./duckduckgo');
      const ddg = new DuckDuckGoSearchProvider();
      return ddg.search(query, limit);
    }

    return this.tagResults(await this.searchApi(query, limit, braveKey));
  }

  private async searchApi(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
        { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' } }
      );

      if (!response.ok) throw new Error(`Brave API error: ${response.status}`);

      const data = (await response.json()) as {
        web?: { results?: Array<{ url: string; title: string; description?: string }> };
      };

      for (const item of (data.web?.results || []).slice(0, limit)) {
        if (item.url && item.title) {
          results.push({ url: item.url, title: item.title, snippet: item.description || '' });
        }
      }

      this.log(`API completed: ${results.length} results`);
    } catch (error) {
      console.error('Brave Search API error:', error);
    }

    return results;
  }
}
