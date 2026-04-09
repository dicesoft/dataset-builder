import { describe, it, expect } from 'vitest';
import { dedupeExact, dedupeByUrl, findDuplicateGroups } from './dedupe';

describe('dedupeExact', () => {
  it('removes exact duplicate records', () => {
    const data = [
      { instruction: 'What is AI?', output: 'AI is...' },
      { instruction: 'What is AI?', output: 'AI is...' },
      { instruction: 'Explain ML', output: 'ML is...' },
    ];
    const result = dedupeExact(data);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ instruction: 'What is AI?', output: 'AI is...' });
    expect(result[1]).toEqual({ instruction: 'Explain ML', output: 'ML is...' });
  });

  it('preserves all unique records', () => {
    const data = [
      { instruction: 'A', output: '1' },
      { instruction: 'B', output: '2' },
      { instruction: 'C', output: '3' },
    ];
    const result = dedupeExact(data);
    expect(result).toHaveLength(3);
    expect(result).toEqual(data);
  });

  it('handles empty array', () => {
    const result = dedupeExact([]);
    expect(result).toEqual([]);
  });

  it('keeps first occurrence when duplicates exist', () => {
    const data = [
      { id: 1, name: 'first' },
      { id: 1, name: 'first' },
      { id: 1, name: 'first' },
    ];
    const result = dedupeExact(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 1, name: 'first' });
  });

  it('deduplicates by specific fields only', () => {
    const data = [
      { instruction: 'What is AI?', output: 'Answer 1', extra: 'a' },
      { instruction: 'What is AI?', output: 'Answer 2', extra: 'b' },
      { instruction: 'Explain ML', output: 'Answer 3', extra: 'c' },
    ];
    const result = dedupeExact(data, ['instruction']);
    expect(result).toHaveLength(2);
    expect((result[0] as Record<string, unknown>).instruction).toBe('What is AI?');
    expect((result[0] as Record<string, unknown>).output).toBe('Answer 1');
    expect((result[1] as Record<string, unknown>).instruction).toBe('Explain ML');
  });

  it('treats records as unique when non-specified fields differ and no fields specified', () => {
    const data = [
      { instruction: 'What is AI?', output: 'Answer 1' },
      { instruction: 'What is AI?', output: 'Answer 2' },
    ];
    const result = dedupeExact(data);
    expect(result).toHaveLength(2);
  });

  it('deduplicates using multiple specific fields', () => {
    const data = [
      { a: 1, b: 2, c: 'x' },
      { a: 1, b: 2, c: 'y' },
      { a: 1, b: 3, c: 'x' },
    ];
    const result = dedupeExact(data, ['a', 'b']);
    expect(result).toHaveLength(2);
  });
});

describe('dedupeByUrl', () => {
  it('removes duplicates with identical URLs', () => {
    const data = [
      { url: 'https://example.com/page', title: 'A' },
      { url: 'https://example.com/page', title: 'B' },
      { url: 'https://example.com/other', title: 'C' },
    ];
    const result = dedupeByUrl(data, 'url');
    expect(result).toHaveLength(2);
  });

  it('normalizes URLs by removing trailing slashes', () => {
    const data = [
      { url: 'https://example.com/page/', title: 'A' },
      { url: 'https://example.com/page', title: 'B' },
    ];
    const result = dedupeByUrl(data, 'url', true);
    expect(result).toHaveLength(1);
  });

  it('normalizes URLs by removing tracking parameters', () => {
    const data = [
      { url: 'https://example.com/page?utm_source=google', title: 'A' },
      { url: 'https://example.com/page?utm_medium=email', title: 'B' },
      { url: 'https://example.com/page', title: 'C' },
    ];
    const result = dedupeByUrl(data, 'url', true);
    expect(result).toHaveLength(1);
  });

  it('normalizes URLs by removing hash fragments', () => {
    const data = [
      { url: 'https://example.com/page#section1', title: 'A' },
      { url: 'https://example.com/page#section2', title: 'B' },
    ];
    const result = dedupeByUrl(data, 'url', true);
    expect(result).toHaveLength(1);
  });

  it('normalizes URLs to lowercase', () => {
    const data = [
      { url: 'https://Example.COM/Page', title: 'A' },
      { url: 'https://example.com/page', title: 'B' },
    ];
    const result = dedupeByUrl(data, 'url', true);
    expect(result).toHaveLength(1);
  });

  it('does not normalize when normalize is false', () => {
    const data = [
      { url: 'https://example.com/page/', title: 'A' },
      { url: 'https://example.com/page', title: 'B' },
    ];
    const result = dedupeByUrl(data, 'url', false);
    expect(result).toHaveLength(2);
  });

  it('skips records with empty or missing URL field', () => {
    const data = [
      { url: 'https://example.com/page', title: 'A' },
      { url: '', title: 'B' },
      { url: null, title: 'C' },
      { title: 'D' },
    ];
    const result = dedupeByUrl(data, 'url');
    expect(result).toHaveLength(1);
  });

  it('preserves non-tracking query parameters during normalization', () => {
    const data = [
      { url: 'https://example.com/search?q=test&page=1', title: 'A' },
      { url: 'https://example.com/search?page=1&q=test', title: 'B' },
    ];
    const result = dedupeByUrl(data, 'url', true);
    // After sorting params, both should normalize identically
    expect(result).toHaveLength(1);
  });
});

describe('findDuplicateGroups', () => {
  it('returns groups of duplicate records with their indices', () => {
    const data = [
      { instruction: 'A', output: '1' },
      { instruction: 'B', output: '2' },
      { instruction: 'A', output: '1' },
      { instruction: 'C', output: '3' },
      { instruction: 'A', output: '1' },
    ];
    const groups = findDuplicateGroups(data);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
    expect(groups[0].map((g) => g.index)).toEqual([0, 2, 4]);
  });

  it('returns empty array when no duplicates exist', () => {
    const data = [
      { instruction: 'A', output: '1' },
      { instruction: 'B', output: '2' },
      { instruction: 'C', output: '3' },
    ];
    const groups = findDuplicateGroups(data);
    expect(groups).toHaveLength(0);
  });

  it('finds duplicates based on specific fields', () => {
    const data = [
      { instruction: 'A', output: '1', extra: 'x' },
      { instruction: 'A', output: '2', extra: 'y' },
      { instruction: 'B', output: '3', extra: 'z' },
    ];
    const groups = findDuplicateGroups(data, ['instruction']);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0].index).toBe(0);
    expect(groups[0][1].index).toBe(1);
  });

  it('returns multiple duplicate groups', () => {
    const data = [
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Charlie' },
    ];
    const groups = findDuplicateGroups(data);
    expect(groups).toHaveLength(2);
  });

  it('handles empty array', () => {
    const groups = findDuplicateGroups([]);
    expect(groups).toHaveLength(0);
  });
});
