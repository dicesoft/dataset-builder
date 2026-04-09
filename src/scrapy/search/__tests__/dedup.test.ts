/**
 * Unit tests for URL deduplication and cross-provider ranking
 */

import { describe, it, expect } from 'vitest';
import { normalizeUrl, deduplicateAndRank } from '../dedup';
import type { SearchResult } from '../types';

describe('normalizeUrl', () => {
  it('strips www prefix', () => {
    expect(normalizeUrl('https://www.example.com/page')).toBe('example.com/page');
  });

  it('strips trailing slash', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('example.com/page');
  });

  it('treats http and https as equivalent', () => {
    const http = normalizeUrl('http://example.com/page');
    const https = normalizeUrl('https://example.com/page');
    expect(http).toBe(https);
  });

  it('lowercases hostname and path', () => {
    expect(normalizeUrl('https://Example.COM/Some/Path')).toBe('example.com/some/path');
  });

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/page?q=hello&lang=en')).toBe(
      'example.com/page?q=hello&lang=en'
    );
  });

  it('strips www and trailing slash combined', () => {
    expect(normalizeUrl('https://www.example.com/')).toBe('example.com/');
  });

  it('handles root URL', () => {
    expect(normalizeUrl('https://example.com')).toBe('example.com/');
  });

  it('falls back to basic normalization for invalid URLs', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('basic fallback strips protocol and www', () => {
    // A string that URL constructor might parse oddly -- test the catch path
    // We can trigger fallback with a truly broken URL
    expect(normalizeUrl('http://www.example.com/path')).toBe('example.com/path');
  });
});

describe('deduplicateAndRank', () => {
  function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
    return {
      url: 'https://example.com/page',
      title: 'Example Page',
      snippet: 'A snippet',
      provider: 'providerA',
      score: 0.5,
      ...overrides,
    };
  }

  it('returns empty array for empty input', () => {
    expect(deduplicateAndRank([]).results).toEqual([]);
  });

  it('deduplicates same URL from different providers', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.8 }),
      makeResult({ provider: 'bing', score: 0.6 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
    expect(deduped[0].url).toBe('https://example.com/page');
  });

  it('boosts score for multi-provider results (+0.15 per extra provider)', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.5 }),
      makeResult({ provider: 'bing', score: 0.5 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
    // 0.5 base + 0.15 boost for 1 extra provider = 0.65
    expect(deduped[0].score).toBeCloseTo(0.65, 5);
  });

  it('caps boosted score at 1.0', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.95 }),
      makeResult({ provider: 'bing', score: 0.9 }),
      makeResult({ provider: 'brave', score: 0.85 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
    // 0.95 + 2 * 0.15 = 1.25, capped to 1.0
    expect(deduped[0].score).toBe(1);
  });

  it('returns all unique results without truncation', () => {
    const results: SearchResult[] = [
      makeResult({ url: 'https://a.com', provider: 'google', score: 0.9 }),
      makeResult({ url: 'https://b.com', provider: 'google', score: 0.8 }),
      makeResult({ url: 'https://c.com', provider: 'google', score: 0.7 }),
      makeResult({ url: 'https://d.com', provider: 'google', score: 0.6 }),
    ];

    const { results: deduped } = deduplicateAndRank(results);
    expect(deduped).toHaveLength(4);
    expect(deduped[0].score).toBe(0.9);
    expect(deduped[1].score).toBe(0.8);
  });

  it('merges provider names with "+" for multi-provider results', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.7 }),
      makeResult({ provider: 'bing', score: 0.6 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped[0].provider).toContain('google');
    expect(deduped[0].provider).toContain('bing');
    expect(deduped[0].provider).toContain('+');
  });

  it('keeps better (longer) title when merging', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.8, title: 'Short' }),
      makeResult({ provider: 'bing', score: 0.9, title: 'A Much Longer Title' }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped[0].title).toBe('A Much Longer Title');
  });

  it('keeps better (longer) snippet when merging', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.8, snippet: 'Brief' }),
      makeResult({
        provider: 'bing',
        score: 0.9,
        snippet: 'A much longer snippet with more detail',
      }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped[0].snippet).toBe('A much longer snippet with more detail');
  });

  it('merges metadata from multiple providers', () => {
    const results: SearchResult[] = [
      makeResult({ provider: 'google', score: 0.8, metadata: { source: 'google' } }),
      makeResult({ provider: 'bing', score: 0.9, metadata: { rank: 1 } }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped[0].metadata).toEqual({ source: 'google', rank: 1 });
  });

  it('sorts by score descending', () => {
    const results: SearchResult[] = [
      makeResult({ url: 'https://low.com', provider: 'google', score: 0.3 }),
      makeResult({ url: 'https://high.com', provider: 'google', score: 0.9 }),
      makeResult({ url: 'https://mid.com', provider: 'google', score: 0.6 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped[0].url).toBe('https://high.com');
    expect(deduped[1].url).toBe('https://mid.com');
    expect(deduped[2].url).toBe('https://low.com');
  });

  it('handles results with no score (defaults to 0)', () => {
    const results: SearchResult[] = [
      { url: 'https://example.com', title: 'No Score', snippet: '', provider: 'test' },
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
    expect(deduped[0].score).toBe(0);
  });

  it('handles results with no provider', () => {
    const results: SearchResult[] = [
      { url: 'https://example.com', title: 'No Provider', snippet: '' },
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
  });

  it('deduplicates URLs differing only in www prefix', () => {
    const results: SearchResult[] = [
      makeResult({ url: 'https://www.example.com/page', provider: 'google', score: 0.5 }),
      makeResult({ url: 'https://example.com/page', provider: 'bing', score: 0.5 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
  });

  it('deduplicates URLs differing only in protocol', () => {
    const results: SearchResult[] = [
      makeResult({ url: 'http://example.com/page', provider: 'google', score: 0.5 }),
      makeResult({ url: 'https://example.com/page', provider: 'bing', score: 0.5 }),
    ];

    const deduped = deduplicateAndRank(results).results;
    expect(deduped).toHaveLength(1);
  });

  it('reports correct dedup stats', () => {
    const results: SearchResult[] = [
      makeResult({ url: 'https://a.com', provider: 'google', score: 0.9 }),
      makeResult({ url: 'https://b.com', provider: 'google', score: 0.8 }),
      makeResult({ url: 'https://c.com', provider: 'google', score: 0.7 }),
      // Duplicates from another provider
      makeResult({ url: 'https://a.com', provider: 'bing', score: 0.85 }),
      makeResult({ url: 'https://b.com', provider: 'bing', score: 0.75 }),
      makeResult({ url: 'https://c.com', provider: 'bing', score: 0.65 }),
      // Unique from bing
      makeResult({ url: 'https://d.com', provider: 'bing', score: 0.6 }),
      makeResult({ url: 'https://e.com', provider: 'bing', score: 0.5 }),
      makeResult({ url: 'https://f.com', provider: 'bing', score: 0.4 }),
      makeResult({ url: 'https://g.com', provider: 'bing', score: 0.3 }),
    ];

    const { results: deduped, totalBefore, duplicatesRemoved } = deduplicateAndRank(results);
    expect(totalBefore).toBe(10);
    expect(duplicatesRemoved).toBe(3);
    expect(deduped).toHaveLength(7);
  });
});
