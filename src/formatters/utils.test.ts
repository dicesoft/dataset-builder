import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFieldValue,
  setFieldValue,
  applyFieldMap,
  applyFieldMapToDataset,
  createSeededRandom,
  shuffleArray,
  splitDataset,
  parseSplitRatios,
  computeHash,
  validateRequiredFields,
  inferType,
  computeStatistics,
  estimateTokens,
  loadData,
  writeData,
} from './utils';

// ─── Mock fs/promises ───────────────────────────────────────────────────────
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
  },
}));

import fs from 'fs/promises';

// ─── getFieldValue ──────────────────────────────────────────────────────────
describe('getFieldValue', () => {
  it('should return a top-level field value', () => {
    expect(getFieldValue({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('should return a nested field value via dot notation', () => {
    const obj = { meta: { author: { name: 'Bob' } } };
    expect(getFieldValue(obj, 'meta.author.name')).toBe('Bob');
  });

  it('should return undefined for a missing nested path', () => {
    expect(getFieldValue({ a: { b: 1 } }, 'a.c.d')).toBeUndefined();
  });

  it('should handle array index notation items[0]', () => {
    const obj = { items: ['first', 'second', 'third'] };
    expect(getFieldValue(obj, 'items[0]')).toBe('first');
    expect(getFieldValue(obj, 'items[2]')).toBe('third');
  });

  it('should handle nested array index like data.items[1].title', () => {
    const obj = { data: { items: [{ title: 'A' }, { title: 'B' }] } };
    expect(getFieldValue(obj, 'data.items[1].title')).toBe('B');
  });

  it('should return undefined when array index is out of bounds', () => {
    expect(getFieldValue({ items: [1] }, 'items[5]')).toBeUndefined();
  });

  it('should return undefined for non-array with index notation', () => {
    expect(getFieldValue({ items: 'not-an-array' }, 'items[0]')).toBeUndefined();
  });

  it('should return undefined for null/undefined obj or empty path', () => {
    expect(getFieldValue(null as unknown as Record<string, unknown>, 'x')).toBeUndefined();
    expect(getFieldValue({ a: 1 }, '')).toBeUndefined();
  });
});

// ─── setFieldValue ──────────────────────────────────────────────────────────
describe('setFieldValue', () => {
  it('should set a top-level field', () => {
    const obj: Record<string, unknown> = {};
    setFieldValue(obj, 'name', 'Alice');
    expect(obj.name).toBe('Alice');
  });

  it('should set a nested field, creating intermediate objects', () => {
    const obj: Record<string, unknown> = {};
    setFieldValue(obj, 'meta.author.name', 'Bob');
    expect((obj as any).meta.author.name).toBe('Bob');
  });

  it('should overwrite an existing value', () => {
    const obj: Record<string, unknown> = { x: 1 };
    setFieldValue(obj, 'x', 2);
    expect(obj.x).toBe(2);
  });

  it('should overwrite a non-object intermediate with an object', () => {
    const obj: Record<string, unknown> = { a: 'string' };
    setFieldValue(obj, 'a.b', 10);
    expect((obj as any).a.b).toBe(10);
  });
});

// ─── applyFieldMap ──────────────────────────────────────────────────────────
describe('applyFieldMap', () => {
  it('should return the record unchanged when fieldMap is empty', () => {
    const record = { a: 1, b: 2 };
    expect(applyFieldMap(record, {})).toBe(record);
  });

  it('should map fields using template expressions', () => {
    const record = { question: 'What?', answer: 'Yes' };
    const fieldMap = { instruction: '{{question}}', output: '{{answer}}' };
    const result = applyFieldMap(record, fieldMap);
    expect(result).toEqual({ instruction: 'What?', output: 'Yes' });
  });

  it('should resolve nested template paths', () => {
    const record = { meta: { author: 'Eve' } };
    const fieldMap = { writer: '{{meta.author}}' };
    expect(applyFieldMap(record, fieldMap)).toEqual({ writer: 'Eve' });
  });

  it('should replace missing template values with empty string', () => {
    const record = { a: 1 };
    const fieldMap = { out: '{{missing}}' };
    expect(applyFieldMap(record, fieldMap)).toEqual({ out: '' });
  });

  it('should handle non-string template values by passing through', () => {
    const record = { a: 1 };
    const fieldMap = { num: 42 as unknown as string };
    expect(applyFieldMap(record, fieldMap)).toEqual({ num: 42 });
  });

  it('should handle composite templates with multiple placeholders', () => {
    const record = { first: 'John', last: 'Doe' };
    const fieldMap = { fullName: '{{first}} {{last}}' };
    expect(applyFieldMap(record, fieldMap)).toEqual({ fullName: 'John Doe' });
  });
});

// ─── applyFieldMapToDataset ─────────────────────────────────────────────────
describe('applyFieldMapToDataset', () => {
  it('should apply the field map to every record', () => {
    const data = [
      { q: 'Q1', a: 'A1' },
      { q: 'Q2', a: 'A2' },
    ];
    const fieldMap = { instruction: '{{q}}', output: '{{a}}' };
    const result = applyFieldMapToDataset(data, fieldMap);
    expect(result).toEqual([
      { instruction: 'Q1', output: 'A1' },
      { instruction: 'Q2', output: 'A2' },
    ]);
  });

  it('should return data as-is when fieldMap is empty', () => {
    const data = [{ x: 1 }];
    expect(applyFieldMapToDataset(data, {})).toBe(data);
  });
});

// ─── createSeededRandom ─────────────────────────────────────────────────────
describe('createSeededRandom', () => {
  it('should produce deterministic output for the same seed', () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(42);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  it('should produce different output for different seeds', () => {
    const rng1 = createSeededRandom(1);
    const rng2 = createSeededRandom(2);
    const val1 = rng1();
    const val2 = rng2();
    expect(val1).not.toBe(val2);
  });

  it('should produce values in the range [0, 1)', () => {
    const rng = createSeededRandom(99);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ─── shuffleArray ───────────────────────────────────────────────────────────
describe('shuffleArray', () => {
  it('should produce a deterministic shuffle with a seeded random', () => {
    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    shuffleArray(arr1, createSeededRandom(7));
    shuffleArray(arr2, createSeededRandom(7));
    expect(arr1).toEqual(arr2);
  });

  it('should mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffleArray(arr, createSeededRandom(7));
    expect(result).toBe(arr);
  });

  it('should contain all original elements', () => {
    const arr = [10, 20, 30, 40, 50];
    shuffleArray(arr, createSeededRandom(123));
    expect(arr.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });
});

// ─── splitDataset ───────────────────────────────────────────────────────────
describe('splitDataset', () => {
  const data = Array.from({ length: 100 }, (_, i) => i);

  it('should split with default 80/10/10 ratios', () => {
    const result = splitDataset(data);
    expect(result.train.length).toBe(80);
    expect(result.validation.length).toBe(10);
    expect(result.test.length).toBe(10);
  });

  it('should split with custom ratios', () => {
    const result = splitDataset(data, [0.6, 0.2, 0.2]);
    expect(result.train.length).toBe(60);
    expect(result.validation.length).toBe(20);
    expect(result.test.length).toBe(20);
  });

  it('should produce reproducible splits with a seed', () => {
    const r1 = splitDataset(data, [0.8, 0.1, 0.1], 42);
    const r2 = splitDataset(data, [0.8, 0.1, 0.1], 42);
    expect(r1.train).toEqual(r2.train);
    expect(r1.validation).toEqual(r2.validation);
    expect(r1.test).toEqual(r2.test);
  });

  it('should throw when ratios do not sum to 1.0', () => {
    expect(() => splitDataset(data, [0.5, 0.2, 0.1])).toThrow('Split ratios must sum to 1.0');
  });

  it('should handle empty data', () => {
    const result = splitDataset([], [0.8, 0.1, 0.1]);
    expect(result).toEqual({ train: [], validation: [], test: [] });
  });
});

// ─── parseSplitRatios ───────────────────────────────────────────────────────
describe('parseSplitRatios', () => {
  it('should parse percentage format "80:10:10"', () => {
    expect(parseSplitRatios('80:10:10')).toEqual([0.8, 0.1, 0.1]);
  });

  it('should parse decimal format "0.8:0.1:0.1"', () => {
    expect(parseSplitRatios('0.8:0.1:0.1')).toEqual([0.8, 0.1, 0.1]);
  });

  it('should handle whitespace around parts', () => {
    expect(parseSplitRatios(' 70 : 20 : 10 ')).toEqual([0.7, 0.2, 0.1]);
  });

  it('should throw for wrong number of parts', () => {
    expect(() => parseSplitRatios('80:20')).toThrow('Invalid split format');
  });

  it('should throw for non-numeric parts', () => {
    expect(() => parseSplitRatios('a:b:c')).toThrow('Invalid split format');
  });
});

// ─── computeHash ────────────────────────────────────────────────────────────
describe('computeHash', () => {
  it('should return the same hash for the same input', () => {
    const obj = { a: 1, b: 'hello' };
    expect(computeHash(obj)).toBe(computeHash(obj));
  });

  it('should return the same hash regardless of key order', () => {
    const obj1 = { a: 1, b: 2 };
    const obj2 = { b: 2, a: 1 };
    expect(computeHash(obj1)).toBe(computeHash(obj2));
  });

  it('should return different hashes for different inputs', () => {
    expect(computeHash({ a: 1 })).not.toBe(computeHash({ a: 2 }));
  });

  it('should return a hex string', () => {
    const hash = computeHash({ x: 'test' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── validateRequiredFields ─────────────────────────────────────────────────
describe('validateRequiredFields', () => {
  it('should report valid when all required fields are present', () => {
    const data = [{ name: 'Alice', age: 30 }];
    const result = validateRequiredFields(data, ['name', 'age']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.stats?.valid).toBe(1);
  });

  it('should report errors for missing fields', () => {
    const data = [{ name: 'Alice' }];
    const result = validateRequiredFields(data, ['name', 'email']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('email');
    expect(result.stats?.invalid).toBe(1);
  });

  it('should treat empty strings as missing', () => {
    const data = [{ name: '' }];
    const result = validateRequiredFields(data, ['name']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should treat null values as missing', () => {
    const data = [{ name: null }];
    const result = validateRequiredFields(data, ['name']);
    expect(result.valid).toBe(false);
  });

  it('should validate multiple records and count correctly', () => {
    const data = [{ a: 1, b: 2 }, { a: 3 }, { a: 4, b: 5 }];
    const result = validateRequiredFields(data, ['a', 'b']);
    expect(result.stats?.total).toBe(3);
    expect(result.stats?.valid).toBe(2);
    expect(result.stats?.invalid).toBe(1);
  });
});

// ─── inferType ──────────────────────────────────────────────────────────────
describe('inferType', () => {
  it('should infer "string"', () => expect(inferType('hello')).toBe('string'));
  it('should infer "number"', () => expect(inferType(42)).toBe('number'));
  it('should infer "boolean"', () => expect(inferType(true)).toBe('boolean'));
  it('should infer "null"', () => expect(inferType(null)).toBe('null'));
  it('should infer "array"', () => expect(inferType([1, 2])).toBe('array'));
  it('should infer "object"', () => expect(inferType({ a: 1 })).toBe('object'));
});

// ─── computeStatistics ──────────────────────────────────────────────────────
describe('computeStatistics', () => {
  it('should return zeroed stats for empty data', () => {
    const stats = computeStatistics([]);
    expect(stats.avgRecordSize).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.fieldStats).toEqual({});
  });

  it('should compute field-level type stats', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const stats = computeStatistics(data);
    expect(stats.fieldStats!.name.type).toBe('string');
    expect(stats.fieldStats!.age.type).toBe('number');
  });

  it('should compute string length stats', () => {
    const data = [{ text: 'hi' }, { text: 'hello' }, { text: 'hey' }];
    const stats = computeStatistics(data);
    const textStats = stats.fieldStats!.text;
    expect(textStats.minLength).toBe(2);
    expect(textStats.maxLength).toBe(5);
    expect(textStats.avgLength).toBeCloseTo(10 / 3);
  });

  it('should compute number stats (min, max, avg)', () => {
    const data = [{ val: 10 }, { val: 20 }, { val: 30 }];
    const stats = computeStatistics(data);
    const valStats = stats.fieldStats!.val;
    expect(valStats.min).toBe(10);
    expect(valStats.max).toBe(30);
    expect(valStats.avg).toBe(20);
  });

  it('should compute avgRecordSize and token estimates', () => {
    const data = [{ a: 'test' }];
    const stats = computeStatistics(data);
    expect(stats.avgRecordSize).toBeGreaterThan(0);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(stats.avgTokensPerRecord).toBeGreaterThan(0);
  });

  it('should track null counts', () => {
    const data = [{ x: 1 }, { x: null }, { x: undefined }];
    const stats = computeStatistics(data);
    expect(stats.fieldStats!.x.nonNull).toBe(1);
    expect(stats.fieldStats!.x.nullCount).toBe(2);
  });
});

// ─── estimateTokens ─────────────────────────────────────────────────────────
describe('estimateTokens', () => {
  it('should return 0 for empty/falsy input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate roughly text.length / 4', () => {
    const text = 'Hello world, this is a test sentence.';
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it('should return a positive integer for any non-empty string', () => {
    expect(estimateTokens('a')).toBe(1);
  });
});

// ─── loadData (mocked fs) ───────────────────────────────────────────────────
describe('loadData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load and parse a JSON file', async () => {
    const jsonContent = JSON.stringify([{ id: 1 }, { id: 2 }]);
    vi.mocked(fs.readFile).mockResolvedValue(jsonContent);

    const result = await loadData('/tmp/data.json');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should wrap a single JSON object in an array', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ id: 1 }));

    const result = await loadData('/tmp/single.json');
    expect(result).toEqual([{ id: 1 }]);
  });

  it('should load and parse a JSONL file', async () => {
    // JSONL loading uses createReadStream (not fs/promises.readFile), so we need a real temp file
    const os = await import('os');
    const path = await import('path');
    const realFs = await import('fs');
    const tmpDir = os.default.tmpdir();
    const tmpFile = path.default.join(tmpDir, `test-${Date.now()}.jsonl`);
    const jsonlContent = '{"a":1}\n{"a":2}\n\n{"a":3}';
    realFs.writeFileSync(tmpFile, jsonlContent, 'utf-8');

    try {
      const result = await loadData(tmpFile);
      expect(result).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    } finally {
      realFs.unlinkSync(tmpFile);
    }
  });

  it('should load and parse a CSV file', async () => {
    const csvContent = 'name,age\nAlice,30\nBob,25';
    vi.mocked(fs.readFile).mockResolvedValue(csvContent);

    const result = await loadData('/tmp/data.csv');
    expect(result).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('should throw for unsupported file formats', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('content');
    await expect(loadData('/tmp/data.xml')).rejects.toThrow('Unsupported file format');
  });
});

// ─── writeData (mocked fs) ──────────────────────────────────────────────────
describe('writeData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('should write JSON data (compact by default)', async () => {
    const data = [{ id: 1 }];
    await writeData('/tmp/out.json', data);
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.json', JSON.stringify(data), 'utf-8');
  });

  it('should write pretty-printed JSON when pretty=true', async () => {
    const data = [{ id: 1 }];
    await writeData('/tmp/out.json', data, true);
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/out.json',
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  });

  it('should write JSONL format', async () => {
    const data = [{ a: 1 }, { a: 2 }];
    await writeData('/tmp/out.jsonl', data);
    const expected = '{"a":1}\n{"a":2}';
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.jsonl', expected, 'utf-8');
  });

  it('should write CSV format', async () => {
    const data = [{ name: 'Alice', age: 30 }];
    await writeData('/tmp/out.csv', data);
    expect(fs.writeFile).toHaveBeenCalled();
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written).toContain('name');
    expect(written).toContain('Alice');
  });

  it('should create parent directories', async () => {
    await writeData('/tmp/deep/nested/out.json', []);
    expect(fs.mkdir).toHaveBeenCalled();
  });
});
