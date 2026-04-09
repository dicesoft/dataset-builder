/**
 * Reddit Search Provider — public JSON API
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';

export class RedditSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'reddit',
    name: 'Reddit',
    category: 'social',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'dataset-builder/1.0 (search provider)',
          Accept: 'application/json',
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = (await response.json()) as {
        data?: {
          children?: Array<{
            data: {
              url?: string;
              permalink?: string;
              title?: string;
              selftext?: string;
              subreddit?: string;
              score?: number;
              num_comments?: number;
              author?: string;
            };
          }>;
        };
      };

      const children = data?.data?.children || [];
      this.log(`Got ${children.length} raw results`);

      for (const child of children) {
        if (results.length >= limit) break;

        const post = child.data;
        const url = post.url || (post.permalink ? `https://www.reddit.com${post.permalink}` : '');
        const title = post.title || '';
        const selftext = post.selftext || '';
        const snippet = selftext.length > 200 ? selftext.slice(0, 200) + '...' : selftext;

        if (url && title) {
          results.push({
            url,
            title,
            snippet,
            metadata: {
              subreddit: post.subreddit,
              score: post.score,
              numComments: post.num_comments,
              author: post.author,
            },
          });
        }
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('Reddit search error:', error);
    }

    return this.tagResults(results);
  }
}
