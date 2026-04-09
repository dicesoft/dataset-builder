import { describe, it, expect } from 'vitest';
import { scoreByLength, filterByScore, sortByQuality } from './quality';

describe('scoreByLength', () => {
  it('scores records based on text length with default (no min/max)', () => {
    const data = [{ text: 'A'.repeat(200) }, { text: 'B'.repeat(30) }];
    const result = scoreByLength(data, 'text');
    expect(result).toHaveLength(2);
    expect(result[0]._quality).toBeDefined();
    expect(result[0]._quality.score).toBeGreaterThanOrEqual(1);
    expect(result[0]._quality.score).toBeLessThanOrEqual(10);
  });

  it('gives lower score when text is below minLength', () => {
    const data = [{ text: 'short' }];
    const result = scoreByLength(data, 'text', 100);
    expect(result[0]._quality.score).toBeLessThan(10);
    expect(result[0]._quality.reason).toContain('below minimum');
  });

  it('gives lower score when text exceeds maxLength', () => {
    const data = [{ text: 'x'.repeat(5000) }];
    const result = scoreByLength(data, 'text', undefined, 1000);
    expect(result[0]._quality.score).toBeLessThanOrEqual(5);
    expect(result[0]._quality.reason).toContain('exceeds maximum');
  });

  it('gives optimal score for text within range', () => {
    const data = [{ text: 'x'.repeat(500) }];
    const result = scoreByLength(data, 'text', 100, 10000);
    expect(result[0]._quality.score).toBe(10);
    expect(result[0]._quality.reason).toContain('Optimal');
  });

  it('handles missing field gracefully (treats as empty string)', () => {
    const data = [{ other: 'no text field' }];
    const result = scoreByLength(data as Record<string, unknown>[], 'text');
    expect(result).toHaveLength(1);
    expect(result[0]._quality).toBeDefined();
    expect(result[0]._quality.score).toBeLessThanOrEqual(10);
  });

  it('handles empty string field', () => {
    const data = [{ text: '' }];
    const result = scoreByLength(data, 'text', 50);
    expect(result[0]._quality.score).toBeLessThan(10);
  });

  it('assigns correct index to each record', () => {
    const data = [{ text: 'first' }, { text: 'second' }, { text: 'third' }];
    const result = scoreByLength(data, 'text');
    expect(result[0]._quality.index).toBe(0);
    expect(result[1]._quality.index).toBe(1);
    expect(result[2]._quality.index).toBe(2);
  });

  it('gives lower score for very short content (< 50 chars) with no min specified', () => {
    const data = [{ text: 'tiny' }];
    const result = scoreByLength(data, 'text');
    expect(result[0]._quality.score).toBe(6);
    expect(result[0]._quality.reason).toContain('Very short');
  });

  it('gives lower score for very long content (> 50000 chars) with no max specified', () => {
    const data = [{ text: 'x'.repeat(60000) }];
    const result = scoreByLength(data, 'text');
    expect(result[0]._quality.score).toBe(7);
    expect(result[0]._quality.reason).toContain('Very long');
  });

  it('preserves original record fields', () => {
    const data = [{ text: 'hello world test content for scoring', extra: 42 }];
    const result = scoreByLength(data, 'text');
    expect(result[0].extra).toBe(42);
    expect(result[0].text).toBe('hello world test content for scoring');
  });
});

describe('filterByScore', () => {
  it('filters records below the threshold', () => {
    const data = [
      { name: 'A', _quality: { index: 0, score: 8, reason: 'good' } },
      { name: 'B', _quality: { index: 1, score: 3, reason: 'bad' } },
      { name: 'C', _quality: { index: 2, score: 6, reason: 'ok' } },
      { name: 'D', _quality: { index: 3, score: 9, reason: 'great' } },
    ];
    const result = filterByScore(data, 7);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('D');
  });

  it('returns all records when all meet threshold', () => {
    const data = [
      { _quality: { index: 0, score: 8, reason: '' } },
      { _quality: { index: 1, score: 9, reason: '' } },
    ];
    const result = filterByScore(data, 5);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when none meet threshold', () => {
    const data = [
      { _quality: { index: 0, score: 2, reason: '' } },
      { _quality: { index: 1, score: 3, reason: '' } },
    ];
    const result = filterByScore(data, 8);
    expect(result).toHaveLength(0);
  });

  it('includes records exactly at the threshold', () => {
    const data = [{ _quality: { index: 0, score: 7, reason: '' } }];
    const result = filterByScore(data, 7);
    expect(result).toHaveLength(1);
  });
});

describe('sortByQuality', () => {
  it('sorts records by score in descending order', () => {
    const data = [
      { name: 'low', _quality: { index: 0, score: 3, reason: '' } },
      { name: 'high', _quality: { index: 1, score: 9, reason: '' } },
      { name: 'mid', _quality: { index: 2, score: 6, reason: '' } },
    ];
    const result = sortByQuality(data);
    expect(result[0].name).toBe('high');
    expect(result[1].name).toBe('mid');
    expect(result[2].name).toBe('low');
  });

  it('does not mutate the original array', () => {
    const data = [
      { _quality: { index: 0, score: 3, reason: '' } },
      { _quality: { index: 1, score: 9, reason: '' } },
    ];
    const original = [...data];
    sortByQuality(data);
    expect(data[0]._quality.score).toBe(original[0]._quality.score);
    expect(data[1]._quality.score).toBe(original[1]._quality.score);
  });

  it('handles empty array', () => {
    const result = sortByQuality([]);
    expect(result).toEqual([]);
  });

  it('handles single element', () => {
    const data = [{ _quality: { index: 0, score: 5, reason: '' } }];
    const result = sortByQuality(data);
    expect(result).toHaveLength(1);
    expect(result[0]._quality.score).toBe(5);
  });
});
