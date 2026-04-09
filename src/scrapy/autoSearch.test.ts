/**
 * Tests for multi-provider comma/space parsing in autoSearch.search()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../utils/logger', () => ({
  verboseLog: vi.fn(),
}));

const emptyDedupResult = { results: [], totalBefore: 0, duplicatesRemoved: 0 };
const mockSearchSingle = vi.fn().mockResolvedValue(emptyDedupResult);
const mockSearchMulti = vi.fn().mockResolvedValue(emptyDedupResult);

vi.mock('./search/registry', () => ({
  ensureProviders: vi.fn().mockResolvedValue(undefined),
  searchSingle: (...args: unknown[]) => mockSearchSingle(...args),
  searchMulti: (...args: unknown[]) => mockSearchMulti(...args),
}));

import { search } from './autoSearch';

describe('search() provider string parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes a single provider to searchSingle', async () => {
    await search('test', 5, 'google');
    expect(mockSearchSingle).toHaveBeenCalledWith('test', 5, 'google');
    expect(mockSearchMulti).not.toHaveBeenCalled();
  });

  it('splits comma-separated providers into searchMulti', async () => {
    await search('test', 5, 'google,bing,duckduckgo');
    expect(mockSearchMulti).toHaveBeenCalledWith('test', 5, ['google', 'bing', 'duckduckgo']);
    expect(mockSearchSingle).not.toHaveBeenCalled();
  });

  it('splits space-separated providers (PowerShell argv mangling)', async () => {
    await search('test', 5, 'ollama google bing duckduckgo');
    expect(mockSearchMulti).toHaveBeenCalledWith('test', 5, [
      'ollama',
      'google',
      'bing',
      'duckduckgo',
    ]);
    expect(mockSearchSingle).not.toHaveBeenCalled();
  });

  it('splits mixed comma-and-space-separated providers', async () => {
    await search('test', 5, 'ollama, google bing,duckduckgo');
    expect(mockSearchMulti).toHaveBeenCalledWith('test', 5, [
      'ollama',
      'google',
      'bing',
      'duckduckgo',
    ]);
  });

  it('trims and filters empty tokens', async () => {
    await search('test', 5, '  google , , bing  ');
    expect(mockSearchMulti).toHaveBeenCalledWith('test', 5, ['google', 'bing']);
  });
});
