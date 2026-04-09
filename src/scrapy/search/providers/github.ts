/**
 * GitHub Search Provider — GitHub REST API (repositories)
 */

import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { getConfig } from '../../../config';

export class GitHubSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'github',
    name: 'GitHub',
    category: 'code',
    requiresApiKey: false,
    apiKeyConfigName: 'githubToken',
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true; // Works without token, just lower rate limits
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const config = getConfig();
    const token = config.get('githubToken' as any) as string | undefined;

    const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'dataset-builder/1.0 (search provider)',
      };

      if (token) {
        headers['Authorization'] = `token ${token}`;
        this.log('Using authenticated request (githubToken)');
      } else {
        this.log('Using unauthenticated request (lower rate limits)');
      }

      const response = await fetch(searchUrl, { headers });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        items?: Array<{
          html_url: string;
          full_name: string;
          description: string | null;
          stargazers_count: number;
          language: string | null;
          forks_count: number;
          topics?: string[];
        }>;
      };

      for (const item of (data.items || []).slice(0, limit)) {
        if (item.html_url && item.full_name) {
          results.push({
            url: item.html_url,
            title: item.full_name,
            snippet: item.description || '',
            metadata: {
              stars: item.stargazers_count,
              language: item.language,
              forks: item.forks_count,
              topics: item.topics || [],
            },
          });
        }
      }

      this.log(`Completed: ${results.length} results`);
    } catch (error) {
      console.error('GitHub search error:', error);
    }

    return this.tagResults(results);
  }
}
