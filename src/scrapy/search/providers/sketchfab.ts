/**
 * Sketchfab Search Provider — REST API
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';

export class SketchfabSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'sketchfab',
    name: 'Sketchfab',
    category: '3d-assets',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(query)}&count=${limit}`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = (await response.json()) as {
        results?: Array<{
          viewerUrl?: string;
          name?: string;
          description?: string;
          thumbnails?: {
            images?: Array<{ url?: string }>;
          };
          viewCount?: number;
          isDownloadable?: boolean;
        }>;
      };

      const models = data?.results || [];
      this.log(`Got ${models.length} raw results`);

      for (const model of models) {
        if (results.length >= limit) break;

        const url = model.viewerUrl || '';
        const title = model.name || '';
        const rawDescription = model.description || '';
        const snippet =
          rawDescription.length > 200 ? rawDescription.slice(0, 200) + '...' : rawDescription;

        const thumbnailUrl = model.thumbnails?.images?.[0]?.url || undefined;

        if (url && title) {
          results.push({
            url,
            title,
            snippet,
            metadata: {
              thumbnailUrl,
              viewCount: model.viewCount,
              isDownloadable: model.isDownloadable,
            },
          });
        }
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('Sketchfab search error:', error);
    }

    return this.tagResults(results);
  }
}
