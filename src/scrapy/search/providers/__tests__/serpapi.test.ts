/**
 * Unit tests for SerpAPI search providers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockApiKey: string | undefined = 'test-key';
let mockSearchLocation: string | undefined = undefined;

vi.mock('../../../../config', () => ({
  getConfig: () => ({
    get: (key: string) => {
      if (key === 'serpApiKey') return mockApiKey;
      if (key === 'searchLocation') return mockSearchLocation;
      return undefined;
    },
    set: vi.fn(),
  }),
}));

vi.mock('../../../../utils/logger', () => ({
  verboseLog: vi.fn(),
}));

const originalFetch = globalThis.fetch;

function mockFetchOk(body: any) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function mockFetchError(status: number, text: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => text,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  mockApiKey = 'test-key';
  mockSearchLocation = undefined;
});

// ─── SerpApiGoogleProvider ──────────────────────────────────────────────────

describe('SerpApiGoogleProvider', () => {
  let SerpApiGoogleProvider: typeof import('../serpapi').SerpApiGoogleProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../serpapi');
    SerpApiGoogleProvider = mod.SerpApiGoogleProvider;
  });

  it('constructs correct URL with engine=google and api_key', async () => {
    const fetch = mockFetchOk({ organic_results: [] });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleProvider();
    await provider.search('test query', 5);

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('serpapi.com/search');
    expect(url).toContain('engine=google');
    expect(url).toContain('api_key=test-key');
    expect(url).toContain('q=test+query');
  });

  it('parses organic_results correctly', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [
        { link: 'https://example.com', title: 'Example', snippet: 'A snippet' },
        { link: 'https://other.com', title: 'Other', snippet: 'Another' },
      ],
    });

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: 'https://example.com',
      title: 'Example',
      snippet: 'A snippet',
      provider: 'serpapi-google',
    });
  });

  it('collects inline_videos alongside organic_results', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [{ link: 'https://example.com', title: 'Example', snippet: 'A snippet' }],
      inline_videos: [
        { link: 'https://youtube.com/watch?v=abc', title: 'Video Result' },
        { link: 'https://vimeo.com/123', title: 'Vimeo Video' },
      ],
    });

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 10);

    expect(results).toHaveLength(3);
    expect(results[0].url).toBe('https://example.com');
    expect(results[1].url).toBe('https://youtube.com/watch?v=abc');
    expect(results[2].url).toBe('https://vimeo.com/123');
  });

  it('paginates when serpapi_pagination.next exists even with < 10 organic results', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [
            { link: 'https://a.com/1', title: 'R1', snippet: '' },
            { link: 'https://a.com/2', title: 'R2', snippet: '' },
            { link: 'https://a.com/3', title: 'R3', snippet: '' },
          ],
          inline_videos: [
            { link: 'https://a.com/v1', title: 'V1' },
            { link: 'https://a.com/v2', title: 'V2' },
          ],
          serpapi_pagination: { next: 'https://serpapi.com/search?start=10' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [
            { link: 'https://a.com/4', title: 'R4', snippet: '' },
            { link: 'https://a.com/5', title: 'R5', snippet: '' },
          ],
          // No serpapi_pagination.next — last page
        }),
      });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 10);

    // Page 1: 3 organic + 2 inline_videos = 5, Page 2: 2 organic = 7 total
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(7);
  });

  it('stops when no serpapi_pagination.next', async () => {
    const fetch = mockFetchOk({
      organic_results: [
        { link: 'https://a.com/1', title: 'R1', snippet: '' },
        { link: 'https://a.com/2', title: 'R2', snippet: '' },
      ],
      // No serpapi_pagination
    });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 10);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
  });

  it('deduplicates URLs across organic + inline_videos', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [
        { link: 'https://example.com', title: 'Example', snippet: 'A snippet' },
        { link: 'https://dupe.com', title: 'Dupe', snippet: '' },
      ],
      inline_videos: [
        { link: 'https://dupe.com', title: 'Dupe Video' }, // Same URL as organic
        { link: 'https://unique.com', title: 'Unique Video' },
      ],
    });

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 10);

    expect(results).toHaveLength(3);
    const urls = results.map((r) => r.url);
    expect(urls).toEqual(['https://example.com', 'https://dupe.com', 'https://unique.com']);
  });

  it('paginates when limit > 10', async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => ({
      link: `https://example.com/${i}`,
      title: `Result ${i}`,
      snippet: '',
    }));
    const page2 = [{ link: 'https://example.com/10', title: 'Result 10', snippet: '' }];

    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: page1,
          serpapi_pagination: { next: 'https://serpapi.com/search?start=10' },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: page2 }) });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 11);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(11);
    // Second call should have start=10
    const url2 = fetch.mock.calls[1][0] as string;
    expect(url2).toContain('start=10');
  });

  it('returns [] on API error', async () => {
    globalThis.fetch = mockFetchError(429, '{"error":"Rate limit exceeded"}');

    const provider = new SerpApiGoogleProvider();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
  });

  it('returns [] when serpApiKey not configured', async () => {
    mockApiKey = undefined;
    vi.resetModules();
    const mod = await import('../serpapi');
    const provider = new mod.SerpApiGoogleProvider();

    globalThis.fetch = vi.fn();
    const results = await provider.search('test', 5);

    expect(results).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('isAvailable returns false without key', async () => {
    mockApiKey = undefined;
    vi.resetModules();
    const mod = await import('../serpapi');
    const provider = new mod.SerpApiGoogleProvider();
    expect(provider.isAvailable()).toBe(false);
  });
});

// ─── SerpApiGoogleImagesProvider ────────────────────────────────────────────

describe('SerpApiGoogleImagesProvider', () => {
  let SerpApiGoogleImagesProvider: typeof import('../serpapi').SerpApiGoogleImagesProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../serpapi');
    SerpApiGoogleImagesProvider = mod.SerpApiGoogleImagesProvider;
  });

  it('constructs correct URL with engine=google_images', async () => {
    const fetch = mockFetchOk({ images_results: [] });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleImagesProvider();
    await provider.search('cats', 5);

    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('engine=google_images');
    expect(url).toContain('ijn=0');
  });

  it('extracts metadata (thumbnail, dimensions, sourceUrl)', async () => {
    globalThis.fetch = mockFetchOk({
      images_results: [
        {
          original: 'https://img.com/cat.jpg',
          title: 'Cat Photo',
          link: 'https://source.com/cat',
          thumbnail: 'https://img.com/cat_thumb.jpg',
          original_width: 1920,
          original_height: 1080,
        },
      ],
    });

    const provider = new SerpApiGoogleImagesProvider();
    const results = await provider.search('cats', 5);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://img.com/cat.jpg');
    expect(results[0].metadata).toMatchObject({
      sourceUrl: 'https://source.com/cat',
      thumbnailUrl: 'https://img.com/cat_thumb.jpg',
      width: 1920,
      height: 1080,
    });
  });

  it('deduplicates image URLs', async () => {
    globalThis.fetch = mockFetchOk({
      images_results: [
        { original: 'https://img.com/cat.jpg', title: 'Cat 1', link: 'https://a.com' },
        { original: 'https://img.com/cat.jpg', title: 'Cat 1 Dupe', link: 'https://b.com' },
        { original: 'https://img.com/dog.jpg', title: 'Dog', link: 'https://c.com' },
      ],
    });

    const provider = new SerpApiGoogleImagesProvider();
    const results = await provider.search('animals', 10);

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://img.com/cat.jpg');
    expect(results[1].url).toBe('https://img.com/dog.jpg');
  });

  it('returns [] on API error', async () => {
    globalThis.fetch = mockFetchError(500, 'Internal error');

    const provider = new SerpApiGoogleImagesProvider();
    const results = await provider.search('cats', 5);
    expect(results).toEqual([]);
  });
});

// ─── SerpApiBingProvider ────────────────────────────────────────────────────

describe('SerpApiBingProvider', () => {
  let SerpApiBingProvider: typeof import('../serpapi').SerpApiBingProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../serpapi');
    SerpApiBingProvider = mod.SerpApiBingProvider;
  });

  it('constructs correct URL with engine=bing', async () => {
    const fetch = mockFetchOk({ organic_results: [] });
    globalThis.fetch = fetch;

    const provider = new SerpApiBingProvider();
    await provider.search('dogs', 5);

    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('engine=bing');
    expect(url).toContain('first=1');
  });

  it('parses bing results correctly', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [
        { link: 'https://bing-result.com', title: 'Bing Result', snippet: 'Found it' },
      ],
    });

    const provider = new SerpApiBingProvider();
    const results = await provider.search('dogs', 5);

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('serpapi-bing');
  });

  it('deduplicates across pages (page 2 returns same URLs → stops)', async () => {
    const page1Items = [
      { link: 'https://bing.com/1', title: 'R1', snippet: '' },
      { link: 'https://bing.com/2', title: 'R2', snippet: '' },
    ];
    // Page 2 returns the same items — all duplicates
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: page1Items,
          serpapi_pagination: { next: 'https://serpapi.com/search?first=11' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: page1Items, // Same URLs!
          serpapi_pagination: { next: 'https://serpapi.com/search?first=21' },
        }),
      });
    globalThis.fetch = fetch;

    const provider = new SerpApiBingProvider();
    const results = await provider.search('dogs', 10);

    // Should stop after page 2 because newCount === 0
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it('newCount === 0 triggers early exit', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [{ link: 'https://bing.com/1', title: 'R1', snippet: '' }],
          serpapi_pagination: { next: 'https://serpapi.com/search?first=11' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [
            { link: 'https://bing.com/1', title: 'R1', snippet: '' }, // Duplicate
          ],
          serpapi_pagination: { next: 'https://serpapi.com/search?first=21' },
        }),
      });
    globalThis.fetch = fetch;

    const provider = new SerpApiBingProvider();
    const results = await provider.search('dogs', 5);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1); // Only 1 unique result
  });

  it('paginates with first=1,11,21...', async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => ({
      link: `https://bing.com/${i}`,
      title: `R${i}`,
      snippet: '',
    }));
    const page2 = [{ link: 'https://bing.com/10', title: 'R10', snippet: '' }];

    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: page1,
          serpapi_pagination: { next: 'https://serpapi.com/search?first=11' },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: page2 }) });
    globalThis.fetch = fetch;

    const provider = new SerpApiBingProvider();
    const results = await provider.search('dogs', 11);

    expect(fetch).toHaveBeenCalledTimes(2);
    const url2 = fetch.mock.calls[1][0] as string;
    expect(url2).toContain('first=11');
    expect(results).toHaveLength(11);
  });
});

// ─── SerpApiDuckDuckGoProvider ──────────────────────────────────────────────

describe('SerpApiDuckDuckGoProvider', () => {
  let SerpApiDuckDuckGoProvider: typeof import('../serpapi').SerpApiDuckDuckGoProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../serpapi');
    SerpApiDuckDuckGoProvider = mod.SerpApiDuckDuckGoProvider;
  });

  it('constructs correct URL with engine=duckduckgo', async () => {
    const fetch = mockFetchOk({ organic_results: [] });
    globalThis.fetch = fetch;

    const provider = new SerpApiDuckDuckGoProvider();
    await provider.search('birds', 5);

    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('engine=duckduckgo');
  });

  it('parses results correctly', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [
        { link: 'https://ddg.com/result', title: 'DDG Result', snippet: 'Found via DDG' },
      ],
    });

    const provider = new SerpApiDuckDuckGoProvider();
    const results = await provider.search('birds', 5);

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('serpapi-duckduckgo');
  });

  it('deduplicates across pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [{ link: 'https://ddg.com/1', title: 'R1', snippet: '' }],
          serpapi_pagination: { next: 'https://serpapi.com/search?start=5' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [
            { link: 'https://ddg.com/1', title: 'R1', snippet: '' }, // Duplicate
          ],
        }),
      });
    globalThis.fetch = fetch;

    const provider = new SerpApiDuckDuckGoProvider();
    const results = await provider.search('birds', 5);

    expect(results).toHaveLength(1);
  });
});

// ─── SerpApiGoogleScholarProvider ───────────────────────────────────────────

describe('SerpApiGoogleScholarProvider', () => {
  let SerpApiGoogleScholarProvider: typeof import('../serpapi').SerpApiGoogleScholarProvider;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../serpapi');
    SerpApiGoogleScholarProvider = mod.SerpApiGoogleScholarProvider;
  });

  it('constructs correct URL with engine=google_scholar', async () => {
    const fetch = mockFetchOk({ organic_results: [] });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleScholarProvider();
    await provider.search('deep learning', 5);

    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('engine=google_scholar');
  });

  it('extracts metadata (authors, citedBy, year, pdfUrl)', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [
        {
          link: 'https://scholar.com/paper',
          title: 'Deep Learning Paper',
          snippet: 'A groundbreaking paper',
          publication_info: {
            authors: [{ name: 'A. Researcher' }, { name: 'B. Scientist' }],
            summary: 'Journal of AI, 2023',
          },
          inline_links: {
            cited_by: { total: 1500 },
          },
          resources: [{ link: 'https://arxiv.org/pdf/1234.pdf' }],
        },
      ],
    });

    const provider = new SerpApiGoogleScholarProvider();
    const results = await provider.search('deep learning', 5);

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('serpapi-google-scholar');
    expect(results[0].metadata).toMatchObject({
      authors: 'A. Researcher, B. Scientist',
      citedBy: 1500,
      year: '2023',
      pdfUrl: 'https://arxiv.org/pdf/1234.pdf',
    });
  });

  it('handles missing metadata gracefully', async () => {
    globalThis.fetch = mockFetchOk({
      organic_results: [
        {
          title: 'Paper Without Links',
          snippet: 'Minimal data',
        },
      ],
    });

    const provider = new SerpApiGoogleScholarProvider();
    const results = await provider.search('test', 5);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('');
    expect(results[0].metadata?.pdfUrl).toBeUndefined();
  });

  it('deduplicates across pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [{ link: 'https://scholar.com/1', title: 'P1', snippet: '' }],
          serpapi_pagination: { next: 'https://serpapi.com/search?start=10' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: [
            { link: 'https://scholar.com/1', title: 'P1', snippet: '' }, // Duplicate
          ],
        }),
      });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleScholarProvider();
    const results = await provider.search('test', 5);

    expect(results).toHaveLength(1);
  });

  it('paginates with start=0,10,20...', async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => ({
      link: `https://scholar.com/${i}`,
      title: `Paper ${i}`,
      snippet: '',
    }));
    const page2 = [{ link: 'https://scholar.com/10', title: 'Paper 10', snippet: '' }];

    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organic_results: page1,
          serpapi_pagination: { next: 'https://serpapi.com/search?start=10' },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: page2 }) });
    globalThis.fetch = fetch;

    const provider = new SerpApiGoogleScholarProvider();
    const results = await provider.search('test', 11);

    expect(fetch).toHaveBeenCalledTimes(2);
    const url2 = fetch.mock.calls[1][0] as string;
    expect(url2).toContain('start=10');
    expect(results).toHaveLength(11);
  });
});

// ─── Location param (serpApiFetch) ──────────────────────────────────────────

describe('serpApiFetch location param', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('includes location param when searchLocation is configured', async () => {
    mockSearchLocation = 'New York,New York,United States';
    vi.resetModules();

    const fetch = mockFetchOk({ organic_results: [] });
    globalThis.fetch = fetch;

    const mod = await import('../serpapi');
    const provider = new mod.SerpApiGoogleProvider();
    await provider.search('test', 5);

    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('location=New+York');
  });

  it('does not include location param when searchLocation is not set', async () => {
    mockSearchLocation = undefined;
    vi.resetModules();

    const fetch = mockFetchOk({ organic_results: [] });
    globalThis.fetch = fetch;

    const mod = await import('../serpapi');
    const provider = new mod.SerpApiGoogleProvider();
    await provider.search('test', 5);

    const url = fetch.mock.calls[0][0] as string;
    expect(url).not.toContain('location=');
  });
});
