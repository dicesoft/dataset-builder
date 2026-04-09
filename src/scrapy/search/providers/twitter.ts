/**
 * Twitter (X) Search Provider — Nitter scraping
 */

import * as cheerio from 'cheerio';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';
import { getRandomUserAgent } from '../utils';

const NITTER_INSTANCES = ['nitter.net', 'nitter.privacydev.net', 'nitter.poast.org'];

export class TwitterSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'twitter',
    name: 'X (Twitter)',
    category: 'social',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    for (const instance of NITTER_INSTANCES) {
      const searchUrl = `https://${instance}/search?q=${encodeURIComponent(query)}`;
      this.log(`Trying Nitter instance: ${instance}`);

      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': getRandomUserAgent(),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });

        if (!response.ok) {
          this.log(`${instance} returned ${response.status}, trying next...`);
          continue;
        }

        const html = await response.text();
        const results = this.parseResults(html, instance, limit);

        if (results.length > 0) {
          this.log(`Completed via ${instance}: ${results.length} results`);
          return this.tagResults(results);
        }

        this.log(`${instance} returned no parseable results, trying next...`);
      } catch (error) {
        this.log(`${instance} failed: ${(error as Error).message}`);
        continue;
      }
    }

    console.warn('Twitter search: all Nitter instances failed or returned no results');
    return [];
  }

  private parseResults(html: string, instance: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    const $ = cheerio.load(html);

    $('.timeline-item').each((_: number, el: any) => {
      if (results.length >= limit) return false;

      const $el = $(el);

      // Extract tweet text
      const tweetContent = $el.find('.tweet-content, .tweet-body').text().trim();
      if (!tweetContent) return;

      // Extract author
      const author = $el.find('.username, .tweet-header a').first().text().trim();

      // Extract permalink
      const permalink = $el.find('a.tweet-link, a[href*="/status/"]').attr('href') || '';
      let url = '';
      if (permalink) {
        // Convert Nitter permalink to Twitter URL
        url = permalink.startsWith('http')
          ? permalink.replace(instance, 'twitter.com')
          : `https://twitter.com${permalink}`;
      }

      // Extract stats
      const statsText = $el.find('.tweet-stat, .icon-container').text() || '';
      const likesMatch = statsText.match(/(\d[\d,]*)\s*(?:like|heart)/i);
      const retweetsMatch = statsText.match(/(\d[\d,]*)\s*(?:retweet|rt)/i);
      const likes = likesMatch ? parseInt(likesMatch[1].replace(/,/g, ''), 10) : undefined;
      const retweets = retweetsMatch ? parseInt(retweetsMatch[1].replace(/,/g, ''), 10) : undefined;

      // Extract date
      const date =
        $el.find('.tweet-date a, time').attr('title') || $el.find('time').attr('datetime') || '';

      const title = tweetContent.length > 100 ? tweetContent.slice(0, 100) + '...' : tweetContent;

      if (url) {
        results.push({
          url,
          title,
          snippet: tweetContent,
          metadata: {
            author,
            likes,
            retweets,
            date,
          },
        });
      }
    });

    return results;
  }
}
