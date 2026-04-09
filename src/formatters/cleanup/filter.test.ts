import { describe, it, expect } from 'vitest';
import { filterByCriteria, removeEmptyValues, balanceByField, sampleRandom } from './filter';

describe('filterByCriteria', () => {
  const data = [
    { name: 'Alice', age: 30, role: 'admin' },
    { name: 'Bob', age: 25, role: 'user' },
    { name: 'Charlie', age: 35, role: 'admin' },
    { name: 'Diana', age: 28, role: 'user' },
    { name: 'Eve', age: 40, role: 'moderator' },
  ];

  it('filters by equals criterion', () => {
    const result = filterByCriteria(data, 'role', { equals: 'admin' });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.role === 'admin')).toBe(true);
  });

  it('filters by contains criterion (case-insensitive)', () => {
    const result = filterByCriteria(data, 'name', { contains: 'ali' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  it('filters by greaterThan criterion', () => {
    const result = filterByCriteria(data, 'age', { greaterThan: 30 });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Charlie');
    expect(result[1].name).toBe('Eve');
  });

  it('filters by lessThan criterion', () => {
    const result = filterByCriteria(data, 'age', { lessThan: 30 });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Bob');
    expect(result[1].name).toBe('Diana');
  });

  it('filters by regex matches criterion', () => {
    const result = filterByCriteria(data, 'name', { matches: /^[A-C]/ });
    expect(result).toHaveLength(3);
  });

  it('filters by in criterion', () => {
    const result = filterByCriteria(data, 'role', { in: ['admin', 'moderator'] });
    expect(result).toHaveLength(3);
  });

  it('filters by exists criterion', () => {
    const dataWithMissing = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob' },
      { name: 'Charlie', email: null },
    ];
    const result = filterByCriteria(dataWithMissing, 'email', { exists: true });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  it('filters by exists: false to find missing values', () => {
    const dataWithMissing = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob' },
      { name: 'Charlie', email: null },
    ];
    const result = filterByCriteria(dataWithMissing, 'email', { exists: false });
    expect(result).toHaveLength(2);
  });

  it('combines multiple criteria (all must match)', () => {
    const result = filterByCriteria(data, 'age', { greaterThan: 25, lessThan: 40 });
    expect(result).toHaveLength(3);
  });

  it('returns empty array when no records match', () => {
    const result = filterByCriteria(data, 'age', { greaterThan: 100 });
    expect(result).toHaveLength(0);
  });

  it('returns all records when criteria match everything', () => {
    const result = filterByCriteria(data, 'age', { greaterThan: 0 });
    expect(result).toHaveLength(5);
  });
});

describe('removeEmptyValues', () => {
  it('removes records with empty string values in specified fields', () => {
    const data = [
      { instruction: 'What is AI?', output: 'AI is...' },
      { instruction: '', output: 'No instruction' },
      { instruction: 'Explain ML', output: '' },
    ];
    const result = removeEmptyValues(data, ['instruction', 'output']);
    expect(result).toHaveLength(1);
    expect(result[0].instruction).toBe('What is AI?');
  });

  it('removes records with null values in specified fields', () => {
    const data = [
      { instruction: 'A', output: 'B' },
      { instruction: null, output: 'C' },
    ];
    const result = removeEmptyValues(data, ['instruction']);
    expect(result).toHaveLength(1);
  });

  it('removes records with undefined values in specified fields', () => {
    const data = [{ instruction: 'A', output: 'B' }, { output: 'C' }];
    const result = removeEmptyValues(data, ['instruction']);
    expect(result).toHaveLength(1);
  });

  it('checks all fields when no specific fields are provided', () => {
    const data = [
      { a: '', b: '', c: '' },
      { a: 'value', b: null, c: undefined },
      { a: null, b: null, c: null },
    ];
    const result = removeEmptyValues(data);
    // The no-fields version uses `.some()` -- any non-empty value means keep
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ a: 'value', b: null, c: undefined });
  });

  it('handles empty input array', () => {
    const result = removeEmptyValues([], ['field']);
    expect(result).toEqual([]);
  });

  it('returns all records when all fields are present', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const result = removeEmptyValues(data, ['name', 'age']);
    expect(result).toHaveLength(2);
  });
});

describe('balanceByField', () => {
  it('limits records per unique field value', () => {
    const data = [
      { category: 'A', id: 1 },
      { category: 'A', id: 2 },
      { category: 'A', id: 3 },
      { category: 'B', id: 4 },
      { category: 'B', id: 5 },
      { category: 'C', id: 6 },
    ];
    const result = balanceByField(data, 'category', 2);
    expect(result).toHaveLength(5);
    const aCounts = result.filter((r) => r.category === 'A').length;
    const bCounts = result.filter((r) => r.category === 'B').length;
    const cCounts = result.filter((r) => r.category === 'C').length;
    expect(aCounts).toBe(2);
    expect(bCounts).toBe(2);
    expect(cCounts).toBe(1);
  });

  it('does not add records when fewer than max exist', () => {
    const data = [
      { category: 'A', id: 1 },
      { category: 'B', id: 2 },
    ];
    const result = balanceByField(data, 'category', 5);
    expect(result).toHaveLength(2);
  });

  it('limits to 1 per value', () => {
    const data = [
      { category: 'A', id: 1 },
      { category: 'A', id: 2 },
      { category: 'B', id: 3 },
      { category: 'B', id: 4 },
    ];
    const result = balanceByField(data, 'category', 1);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(3);
  });

  it('handles empty input', () => {
    const result = balanceByField([], 'category', 5);
    expect(result).toEqual([]);
  });
});

describe('sampleRandom', () => {
  it('returns the correct number of samples', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const result = sampleRandom(data, 10);
    expect(result).toHaveLength(10);
  });

  it('returns all records when n >= data length', () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = sampleRandom(data, 5);
    expect(result).toHaveLength(3);
  });

  it('returns empty array when n <= 0', () => {
    const data = [{ id: 1 }, { id: 2 }];
    expect(sampleRandom(data, 0)).toEqual([]);
    expect(sampleRandom(data, -1)).toEqual([]);
  });

  it('produces deterministic results with same seed', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const result1 = sampleRandom(data, 10, 42);
    const result2 = sampleRandom(data, 10, 42);
    expect(result1).toEqual(result2);
  });

  it('produces different results with different seeds', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const result1 = sampleRandom(data, 10, 42);
    const result2 = sampleRandom(data, 10, 99);
    // Very unlikely to be exactly the same with different seeds
    const ids1 = result1.map((r) => r.id).sort((a, b) => a - b);
    const ids2 = result2.map((r) => r.id).sort((a, b) => a - b);
    expect(ids1).not.toEqual(ids2);
  });

  it('does not mutate the original array', () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const original = data.map((d) => ({ ...d }));
    sampleRandom(data, 3, 42);
    expect(data).toEqual(original);
  });

  it('returns unique records (no duplicates)', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const result = sampleRandom(data, 10, 42);
    const ids = result.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });
});
