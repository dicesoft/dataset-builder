/**
 * Unit tests for representative search providers with mocked HTTP responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config so getConfig doesn't fail
vi.mock('../../../config', () => ({
  getConfig: () => ({
    get: (_key: string) => undefined,
  }),
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  verboseLog: vi.fn(),
}));

// Store the original fetch
const originalFetch = globalThis.fetch;

describe('RedditSearchProvider', () => {
  let RedditSearchProvider: typeof import('../providers/reddit').RedditSearchProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../providers/reddit');
    RedditSearchProvider = mod.RedditSearchProvider;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls the correct Reddit search URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    });
    globalThis.fetch = mockFetch;

    const provider = new RedditSearchProvider();
    await provider.search('test query', 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('reddit.com/search.json');
    expect(calledUrl).toContain('q=test%20query');
    expect(calledUrl).toContain('limit=5');
  });

  it('sends correct headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { children: [] } }),
    });
    globalThis.fetch = mockFetch;

    const provider = new RedditSearchProvider();
    await provider.search('test', 5);

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['User-Agent']).toContain('dataset-builder');
    expect((opts.headers as Record<string, string>)['Accept']).toBe('application/json');
  });

  it('extracts results from Reddit JSON response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                url: 'https://reddit.com/r/test/comments/abc',
                title: 'Test Post',
                selftext: 'This is the post body',
                subreddit: 'test',
                score: 42,
                num_comments: 10,
                author: 'testuser',
              },
            },
            {
              data: {
                permalink: '/r/other/comments/def',
                title: 'Another Post',
                selftext: '',
                subreddit: 'other',
                score: 7,
                num_comments: 2,
                author: 'otheruser',
              },
            },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = new RedditSearchProvider();
    const results = await provider.search('test', 10);

    expect(results).toHaveLength(2);

    // First result uses url field
    expect(results[0].url).toBe('https://reddit.com/r/test/comments/abc');
    expect(results[0].title).toBe('Test Post');
    expect(results[0].snippet).toBe('This is the post body');
    expect(results[0].provider).toBe('reddit');
    expect(results[0].metadata?.subreddit).toBe('test');
    expect(results[0].metadata?.score).toBe(42);
    expect(results[0].metadata?.numComments).toBe(10);
    expect(results[0].metadata?.author).toBe('testuser');

    // Second result uses permalink
    expect(results[1].url).toBe('https://www.reddit.com/r/other/comments/def');
    expect(results[1].title).toBe('Another Post');
  });

  it('truncates long selftext to 200 chars with ellipsis', async () => {
    const longText = 'A'.repeat(250);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                url: 'https://reddit.com/r/test/comments/abc',
                title: 'Long Post',
                selftext: longText,
                subreddit: 'test',
              },
            },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = new RedditSearchProvider();
    const results = await provider.search('test', 10);

    expect(results[0].snippet.length).toBe(203); // 200 + '...'
    expect(results[0].snippet.endsWith('...')).toBe(true);
  });

  it('returns empty array on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });
    globalThis.fetch = mockFetch;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new RedditSearchProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    errorSpy.mockRestore();
  });

  it('returns empty array on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    globalThis.fetch = mockFetch;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new RedditSearchProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    errorSpy.mockRestore();
  });

  it('skips entries missing both url and permalink', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            { data: { title: 'No URL', selftext: 'text' } },
            { data: { url: 'https://example.com', title: 'Has URL' } },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = new RedditSearchProvider();
    const results = await provider.search('test', 10);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Has URL');
  });
});

describe('ArxivSearchProvider', () => {
  let ArxivSearchProvider: typeof import('../providers/arxiv').ArxivSearchProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../providers/arxiv');
    ArxivSearchProvider = mod.ArxivSearchProvider;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2301.00001v1</id>
    <title>Machine Learning for Beginners</title>
    <summary>This paper introduces basic concepts of ML.</summary>
    <published>2023-01-15T00:00:00Z</published>
    <link href="http://arxiv.org/abs/2301.00001v1" rel="alternate" type="text/html"/>
    <link href="http://arxiv.org/pdf/2301.00001v1" rel="related" type="application/pdf"/>
    <author><name>John Doe</name></author>
    <author><name>Jane Smith</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2302.00002v1</id>
    <title>Deep Learning Survey</title>
    <summary>A comprehensive survey of deep learning techniques.</summary>
    <published>2023-02-20T00:00:00Z</published>
    <link href="http://arxiv.org/abs/2302.00002v1" rel="alternate" type="text/html"/>
    <author><name>Alice Brown</name></author>
  </entry>
</feed>`;

  it('calls the correct arXiv API URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<feed></feed>',
    });
    globalThis.fetch = mockFetch;

    const provider = new ArxivSearchProvider();
    await provider.search('neural networks', 10);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('export.arxiv.org/api/query');
    expect(calledUrl).toContain('search_query=all:neural%20networks');
    expect(calledUrl).toContain('max_results=10');
  });

  it('sends Accept header for Atom XML', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<feed></feed>',
    });
    globalThis.fetch = mockFetch;

    const provider = new ArxivSearchProvider();
    await provider.search('test', 5);

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Accept']).toBe('application/atom+xml');
  });

  it('extracts results from arXiv XML response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => arxivXml,
    });
    globalThis.fetch = mockFetch;

    const provider = new ArxivSearchProvider();
    const results = await provider.search('machine learning', 10);

    expect(results).toHaveLength(2);

    expect(results[0].title).toBe('Machine Learning for Beginners');
    expect(results[0].url).toBe('http://arxiv.org/abs/2301.00001v1');
    expect(results[0].snippet).toContain('basic concepts of ML');
    expect(results[0].provider).toBe('arxiv');
    expect(results[0].category).toBe('academic');
    expect(results[0].metadata?.authors).toEqual(['John Doe', 'Jane Smith']);
    expect(results[0].metadata?.publishedDate).toBe('2023-01-15T00:00:00Z');
    expect(results[0].metadata?.pdfUrl).toBe('http://arxiv.org/pdf/2301.00001v1');

    expect(results[1].title).toBe('Deep Learning Survey');
    expect(results[1].metadata?.authors).toEqual(['Alice Brown']);
  });

  it('respects limit parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => arxivXml,
    });
    globalThis.fetch = mockFetch;

    const provider = new ArxivSearchProvider();
    const results = await provider.search('test', 1);

    // The provider passes limit to the API and also enforces it locally
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    globalThis.fetch = mockFetch;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new ArxivSearchProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    errorSpy.mockRestore();
  });

  it('returns empty array on fetch failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('DNS failure'));
    globalThis.fetch = mockFetch;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new ArxivSearchProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    errorSpy.mockRestore();
  });
});

describe('GitHubSearchProvider', () => {
  let GitHubSearchProvider: typeof import('../providers/github').GitHubSearchProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../providers/github');
    GitHubSearchProvider = mod.GitHubSearchProvider;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const githubResponse = {
    items: [
      {
        html_url: 'https://github.com/user/repo1',
        full_name: 'user/repo1',
        description: 'A great repo',
        stargazers_count: 1500,
        language: 'TypeScript',
        forks_count: 200,
        topics: ['ai', 'ml'],
      },
      {
        html_url: 'https://github.com/user/repo2',
        full_name: 'user/repo2',
        description: null,
        stargazers_count: 50,
        language: 'Python',
        forks_count: 5,
        topics: [],
      },
    ],
  };

  it('calls the correct GitHub API URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    globalThis.fetch = mockFetch;

    const provider = new GitHubSearchProvider();
    await provider.search('dataset builder', 10);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('api.github.com/search/repositories');
    expect(calledUrl).toContain('q=dataset%20builder');
    expect(calledUrl).toContain('per_page=10');
    expect(calledUrl).toContain('sort=stars');
  });

  it('sends correct headers for unauthenticated request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    globalThis.fetch = mockFetch;

    const provider = new GitHubSearchProvider();
    await provider.search('test', 5);

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/vnd.github.v3+json');
    expect(headers['User-Agent']).toContain('dataset-builder');
    // No auth header when no token configured
    expect(headers['Authorization']).toBeUndefined();
  });

  it('extracts results from GitHub API response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => githubResponse,
    });
    globalThis.fetch = mockFetch;

    const provider = new GitHubSearchProvider();
    const results = await provider.search('test', 10);

    expect(results).toHaveLength(2);

    expect(results[0].url).toBe('https://github.com/user/repo1');
    expect(results[0].title).toBe('user/repo1');
    expect(results[0].snippet).toBe('A great repo');
    expect(results[0].provider).toBe('github');
    expect(results[0].category).toBe('code');
    expect(results[0].metadata?.stars).toBe(1500);
    expect(results[0].metadata?.language).toBe('TypeScript');
    expect(results[0].metadata?.forks).toBe(200);
    expect(results[0].metadata?.topics).toEqual(['ai', 'ml']);

    // Null description becomes empty string
    expect(results[1].snippet).toBe('');
    expect(results[1].metadata?.topics).toEqual([]);
  });

  it('returns empty array on API error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });
    globalThis.fetch = mockFetch;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new GitHubSearchProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    errorSpy.mockRestore();
  });

  it('returns empty array on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    globalThis.fetch = mockFetch;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new GitHubSearchProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    errorSpy.mockRestore();
  });

  it('handles empty items array', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    globalThis.fetch = mockFetch;

    const provider = new GitHubSearchProvider();
    const results = await provider.search('obscure query', 10);

    expect(results).toEqual([]);
  });

  it('handles missing items in response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    const provider = new GitHubSearchProvider();
    const results = await provider.search('test', 10);

    expect(results).toEqual([]);
  });
});
