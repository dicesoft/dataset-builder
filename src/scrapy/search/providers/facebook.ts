/**
 * Facebook Search Provider — best-effort scraping (m.facebook.com)
 *
 * Facebook is VERY aggressive with anti-bot measures.
 * This provider is best-effort and will gracefully degrade.
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { detectAntiBot, getRandomUserAgent } from '../utils';

export class FacebookSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'facebook',
    name: 'Facebook',
    category: 'social',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const searchUrl = `https://m.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;
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
        console.warn(
          `Facebook search returned HTTP ${response.status} — Facebook anti-bot likely active`
        );
        return [];
      }

      const html = await response.text();
      this.log(`Response size: ${html.length} bytes`);

      const blockCheck = detectAntiBot(html);
      if (blockCheck.isBlocked) {
        console.warn(`Facebook search blocked: ${blockCheck.reason}`);
        return [];
      }

      const results = this.parseResults(html, limit);
      this.log(`Completed: ${results.length} results`);
      return this.tagResults(results);
    } catch (error) {
      console.warn(
        `Facebook search failed (anti-bot protection likely active): ${(error as Error).message}`
      );
      return [];
    }
  }

  private parseResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    const $ = cheerio.load(html);

    // Mobile Facebook uses various container elements for posts
    const postSelectors = [
      'article',
      '[data-ft]',
      '.story_body_container',
      '[role="article"]',
      '.bx',
      '.by',
    ];

    for (const selector of postSelectors) {
      const elements = $(selector);
      if (elements.length === 0) continue;

      elements.each((_: number, el: any) => {
        if (results.length >= limit) return false;

        const $el = $(el);

        // Extract post text
        const postText = $el.find('p, .story_body_container, [data-gt]').text().trim();
        if (!postText || postText.length < 10) return;

        // Extract author/page name
        const author = $el.find('h3 a, strong a, header a').first().text().trim() || '';

        // Extract post URL
        let url = '';
        const postLink =
          $el
            .find('a[href*="/story.php"], a[href*="/posts/"], a[href*="/permalink/"]')
            .attr('href') || '';
        if (postLink) {
          url = postLink.startsWith('http') ? postLink : `https://m.facebook.com${postLink}`;
        }

        // Extract reactions/shares (if visible)
        const reactionsText = $el
          .find('[data-sigil="reactions-sentence-container"], .like_def')
          .text()
          .trim();
        const sharesText = $el.find('[data-sigil="share-count"], .share_def').text().trim();
        const reactionsMatch = reactionsText.match(/(\d[\d,]*)/);
        const sharesMatch = sharesText.match(/(\d[\d,]*)/);
        const reactions = reactionsMatch
          ? parseInt(reactionsMatch[1].replace(/,/g, ''), 10)
          : undefined;
        const shares = sharesMatch ? parseInt(sharesMatch[1].replace(/,/g, ''), 10) : undefined;

        // Extract date
        const date = $el.find('abbr, time').text().trim() || '';

        const title = author || postText.split('\n')[0].slice(0, 100);
        const snippet = postText.length > 300 ? postText.slice(0, 300) + '...' : postText;

        if (url || postText) {
          results.push({
            url:
              url ||
              `https://www.facebook.com/search/posts/?q=${encodeURIComponent(postText.slice(0, 50))}`,
            title,
            snippet,
            metadata: {
              author,
              reactions,
              shares,
              date,
            },
          });
        }
      });

      if (results.length > 0) break; // Stop trying selectors once we have results
    }

    return results;
  }
}
