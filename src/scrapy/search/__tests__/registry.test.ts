/**
 * Unit tests for search provider registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SearchProvider, SearchProviderConfig, SearchResult } from '../types';

// Mock logger to suppress verbose output
vi.mock('../../../utils/logger', () => ({
  verboseLog: vi.fn(),
}));

// Mock dedup module so we can verify it's called correctly
vi.mock('../dedup', () => ({
  deduplicateAndRank: vi.fn((results: SearchResult[]) => ({
    results,
    totalBefore: results.length,
    duplicatesRemoved: 0,
  })),
}));

// We need to reset the module between tests since registry uses module-level state
let registerProvider: typeof import('../registry').registerProvider;
let getProvider: typeof import('../registry').getProvider;
let listProviders: typeof import('../registry').listProviders;
let searchSingle: typeof import('../registry').searchSingle;
let searchMulti: typeof import('../registry').searchMulti;

/**
 * Create a mock search provider with controllable behavior
 */
function createMockProvider(
  id: string,
  results: SearchResult[] = [],
  available = true,
  shouldThrow = false
): SearchProvider {
  return {
    config: {
      id,
      name: `Mock ${id}`,
      category: 'web',
      requiresApiKey: false,
      hasFallback: false,
    } as SearchProviderConfig,
    isAvailable: vi.fn(() => available),
    search: vi.fn(async (_query: string, _limit: number) => {
      if (shouldThrow) throw new Error(`${id} failed`);
      return results;
    }),
  };
}

function makeResult(url: string, provider: string, score = 0.5): SearchResult {
  return { url, title: `Result from ${provider}`, snippet: '', provider, score };
}

describe('Search Registry', () => {
  beforeEach(async () => {
    // Re-import registry each time to get a fresh module-level Map
    vi.resetModules();
    const mod = await import('../registry');
    registerProvider = mod.registerProvider;
    getProvider = mod.getProvider;
    listProviders = mod.listProviders;
    searchSingle = mod.searchSingle;
    searchMulti = mod.searchMulti;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerProvider / getProvider', () => {
    it('registers and retrieves a provider by ID', () => {
      const mockProvider = createMockProvider('test-provider');
      registerProvider(mockProvider);

      const retrieved = getProvider('test-provider');
      expect(retrieved).toBe(mockProvider);
    });

    it('returns undefined for unknown provider ID', () => {
      expect(getProvider('nonexistent')).toBeUndefined();
    });

    it('overwrites a provider with the same ID', () => {
      const first = createMockProvider('dup');
      const second = createMockProvider('dup');
      registerProvider(first);
      registerProvider(second);

      expect(getProvider('dup')).toBe(second);
    });
  });

  describe('listProviders', () => {
    it('returns empty array when no providers registered', () => {
      expect(listProviders()).toEqual([]);
    });

    it('returns all registered providers', () => {
      registerProvider(createMockProvider('alpha'));
      registerProvider(createMockProvider('beta'));
      registerProvider(createMockProvider('gamma'));

      const list = listProviders();
      expect(list).toHaveLength(3);
      const ids = list.map((p) => p.config.id);
      expect(ids).toContain('alpha');
      expect(ids).toContain('beta');
      expect(ids).toContain('gamma');
    });
  });

  describe('searchSingle', () => {
    it('calls the correct provider with query and limit', async () => {
      const results = [makeResult('https://a.com', 'my-provider')];
      const provider = createMockProvider('my-provider', results);
      registerProvider(provider);

      const output = await searchSingle('test query', 5, 'my-provider');

      expect(provider.search).toHaveBeenCalledWith('test query', 5);
      expect(output.results).toEqual(results);
      expect(output.duplicatesRemoved).toBe(0);
    });

    it('returns empty results for unknown provider', async () => {
      const output = await searchSingle('test', 10, 'nonexistent');
      expect(output.results).toEqual([]);
    });
  });

  describe('searchMulti', () => {
    it('returns empty results when no provider IDs given', async () => {
      const output = await searchMulti('test', 10, []);
      expect(output.results).toEqual([]);
    });

    it('delegates to searchSingle when only one provider ID given', async () => {
      const results = [makeResult('https://a.com', 'solo')];
      const provider = createMockProvider('solo', results);
      registerProvider(provider);

      const output = await searchMulti('test', 5, ['solo']);

      expect(provider.search).toHaveBeenCalledWith('test', 5);
      expect(output.results).toEqual(results);
    });

    it('runs multiple providers in parallel with full count each', async () => {
      const resultsA = [makeResult('https://a.com', 'alpha')];
      const resultsB = [makeResult('https://b.com', 'beta')];
      const providerA = createMockProvider('alpha', resultsA);
      const providerB = createMockProvider('beta', resultsB);
      registerProvider(providerA);
      registerProvider(providerB);

      await searchMulti('test', 15, ['alpha', 'beta']);

      // Each provider should receive the full count (15), not divided
      expect(providerA.search).toHaveBeenCalledWith('test', 15);
      expect(providerB.search).toHaveBeenCalledWith('test', 15);
    });

    it('handles provider failures gracefully (some succeed, some fail)', async () => {
      const goodResults = [makeResult('https://good.com', 'good')];
      const goodProvider = createMockProvider('good', goodResults);
      const badProvider = createMockProvider('bad', [], true, true); // available but throws
      registerProvider(goodProvider);
      registerProvider(badProvider);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const output = await searchMulti('test', 10, ['good', 'bad']);

      // Should still get results from the good provider
      expect(output.results.length).toBeGreaterThanOrEqual(1);
      expect(output.results.some((r) => r.url === 'https://good.com')).toBe(true);

      warnSpy.mockRestore();
    });

    it('warns on unknown provider IDs and skips them', async () => {
      const results = [makeResult('https://a.com', 'known')];
      registerProvider(createMockProvider('known', results));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await searchMulti('test', 10, ['known', 'unknown-xyz']);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown-xyz'));

      warnSpy.mockRestore();
    });

    it('skips unavailable providers with a warning', async () => {
      const available = createMockProvider('avail', [makeResult('https://a.com', 'avail')]);
      const unavailable = createMockProvider('no-key', [], false); // not available
      registerProvider(available);
      registerProvider(unavailable);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await searchMulti('test', 10, ['avail', 'no-key']);

      expect(unavailable.search).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no-key'));

      warnSpy.mockRestore();
    });

    it('returns empty array when all providers are unavailable', async () => {
      registerProvider(createMockProvider('off1', [], false));
      registerProvider(createMockProvider('off2', [], false));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const output = await searchMulti('test', 10, ['off1', 'off2']);
      expect(output.results).toEqual([]);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('calls deduplicateAndRank for multi-provider results', async () => {
      const { deduplicateAndRank } = await import('../dedup');
      const resultsA = [makeResult('https://a.com', 'alpha')];
      const resultsB = [makeResult('https://b.com', 'beta')];
      registerProvider(createMockProvider('alpha', resultsA));
      registerProvider(createMockProvider('beta', resultsB));

      await searchMulti('test', 10, ['alpha', 'beta']);

      expect(deduplicateAndRank).toHaveBeenCalled();
    });
  });
});
