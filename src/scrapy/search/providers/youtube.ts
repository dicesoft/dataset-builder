/**
 * YouTube Search Provider — uses yt-dlp ytsearch
 */

import { spawn } from 'child_process';
import { BaseSearchProvider } from '../BaseSearchProvider';
import type { SearchProviderConfig, SearchResult } from '../types';

export class YouTubeSearchProvider extends BaseSearchProvider {
  readonly config: SearchProviderConfig = {
    id: 'youtube',
    name: 'YouTube',
    category: 'video',
    requiresApiKey: false,
    hasFallback: false,
  };

  isAvailable(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    this.log(`Searching via yt-dlp: ytsearch${limit}:${query}`);

    const results = await new Promise<SearchResult[]>((resolve) => {
      const ytdlp = spawn('yt-dlp', [
        `ytsearch${limit}:${query}`,
        '--flat-playlist',
        '--dump-json',
        '--no-download',
        '--no-warnings',
      ]);

      let output = '';
      let stderr = '';

      ytdlp.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      ytdlp.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code !== 0 && !output) {
          this.log(`yt-dlp exited with code ${code}: ${stderr}`);
          console.error('YouTube search failed. Make sure yt-dlp is installed.');
          resolve([]);
          return;
        }

        const items: SearchResult[] = [];
        const lines = output.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const videoId = entry.id || '';
            const url =
              entry.url ||
              entry.webpage_url ||
              (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
            const title = entry.title || '';

            const snippetParts: string[] = [];
            if (entry.uploader) snippetParts.push(entry.uploader);
            if (entry.duration_string) snippetParts.push(entry.duration_string);
            else if (entry.duration)
              snippetParts.push(
                `${Math.floor(entry.duration / 60)}:${String(entry.duration % 60).padStart(2, '0')}`
              );
            if (entry.view_count) snippetParts.push(`${entry.view_count.toLocaleString()} views`);
            const snippet = snippetParts.join(' | ');

            if (url && title) {
              items.push({ url, title, snippet });
            }
          } catch {
            // Skip malformed lines
          }
        }

        this.log(`Completed: ${items.length} results`);
        resolve(items);
      });

      ytdlp.on('error', (error) => {
        if (error.message?.includes('ENOENT')) {
          console.error('yt-dlp not found. Install it: pip install yt-dlp');
        } else {
          console.error('YouTube search error:', error.message);
        }
        resolve([]);
      });
    });

    return this.tagResults(results);
  }
}
