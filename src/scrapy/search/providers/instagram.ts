/**
 * Instagram Search Provider — explore/tags page scraping
 *
 * Instagram frequently blocks scraping attempts.
 * This provider uses graceful degradation and returns empty results on failure.
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { getRandomUserAgent } from '../utils';

export class InstagramSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    // Instagram tags don't support spaces — use first word or remove spaces
    const tag = query.replace(/\s+/g, '').toLowerCase();
    const searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
    this.log(`Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          DNT: '1',
          Connection: 'keep-alive',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        console.warn(`Instagram search returned HTTP ${response.status} — scraping likely blocked`);
        return [];
      }

      const html = await response.text();
      this.log(`Response size: ${html.length} bytes`);

      const results = this.parseResults(html, limit);
      this.log(`Completed: ${results.length} results`);
      return this.tagResults(results);
    } catch (error) {
      console.warn(
        `Instagram search failed (scraping likely blocked): ${(error as Error).message}`
      );
      return [];
    }
  }

  private parseResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    const $ = cheerio.load(html);

    // Try to extract data from window._sharedData or window.__additionalDataLoaded
    const scripts = $('script').toArray();
    for (const script of scripts) {
      if (results.length >= limit) break;

      const scriptContent = $(script).html() || '';

      // Try window._sharedData
      let jsonData: any = null;
      const sharedDataMatch = scriptContent.match(/window\._sharedData\s*=\s*({.+?})\s*;?\s*$/s);
      if (sharedDataMatch) {
        try {
          jsonData = JSON.parse(sharedDataMatch[1]);
          const edges =
            jsonData?.entry_data?.TagPage?.[0]?.graphql?.hashtag?.edge_hashtag_to_media?.edges ||
            jsonData?.entry_data?.TagPage?.[0]?.graphql?.hashtag?.edge_hashtag_to_top_posts
              ?.edges ||
            [];
          this.extractFromEdges(edges, results, limit);
        } catch {
          // JSON parse failed, try next
        }
      }

      // Try window.__additionalDataLoaded
      const additionalDataMatch = scriptContent.match(
        /window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*({.+?})\s*\)\s*;?\s*$/s
      );
      if (additionalDataMatch && results.length < limit) {
        try {
          jsonData = JSON.parse(additionalDataMatch[1]);
          const edges =
            jsonData?.graphql?.hashtag?.edge_hashtag_to_media?.edges ||
            jsonData?.graphql?.hashtag?.edge_hashtag_to_top_posts?.edges ||
            jsonData?.data?.hashtag?.edge_hashtag_to_media?.edges ||
            [];
          this.extractFromEdges(edges, results, limit);
        } catch {
          // JSON parse failed
        }
      }
    }

    // Fallback: try to extract from any JSON-like structures in the page
    if (results.length === 0) {
      const allHtml = $.html() || '';
      const shortcodeMatches = allHtml.match(/"shortcode"\s*:\s*"([A-Za-z0-9_-]+)"/g);
      if (shortcodeMatches) {
        for (const match of shortcodeMatches) {
          if (results.length >= limit) break;
          const codeMatch = match.match(/"shortcode"\s*:\s*"([A-Za-z0-9_-]+)"/);
          if (codeMatch) {
            results.push({
              url: `https://www.instagram.com/p/${codeMatch[1]}/`,
              title: `Instagram post ${codeMatch[1]}`,
              snippet: '',
              metadata: {
                author: undefined,
                likes: undefined,
                mediaUrl: undefined,
                mediaType: undefined,
              },
            });
          }
        }
      }
    }

    return results;
  }

  private extractFromEdges(edges: any[], results: SearchResult[], limit: number): void {
    for (const edge of edges) {
      if (results.length >= limit) break;

      const node = edge?.node;
      if (!node) continue;

      const shortcode = node.shortcode || '';
      const url = shortcode ? `https://www.instagram.com/p/${shortcode}/` : '';
      if (!url) continue;

      const caption =
        node.edge_media_to_caption?.edges?.[0]?.node?.text || node.accessibility_caption || '';
      const title =
        caption.length > 100
          ? caption.slice(0, 100) + '...'
          : caption || `Instagram post ${shortcode}`;

      const owner = node.owner?.username || node.owner?.id || '';
      const likes = node.edge_liked_by?.count ?? node.edge_media_preview_like?.count;
      const mediaUrl = node.display_url || node.thumbnail_src || '';
      const isVideo = node.is_video || false;
      const mediaType = isVideo ? 'video' : 'image';

      results.push({
        url,
        title,
        snippet: caption,
        metadata: {
          author: owner,
          likes,
          mediaUrl,
          mediaType,
        },
      });
    }
  }
}
