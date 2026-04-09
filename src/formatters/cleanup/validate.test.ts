import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateRequiredFields,
  validateTypes,
  validateEmails,
  validateUrls,
  validateDates,
  validateRanges,
  validateWithZod,
  createSchemaFromTypeMap,
} from './validate';

describe('validateRequiredFields', () => {
  it('returns valid when all required fields are present', () => {
    const data = [
      { instruction: 'What is AI?', output: 'AI is...' },
      { instruction: 'Explain ML', output: 'ML is...' },
    ];
    const result = validateRequiredFields(data, ['instruction', 'output']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.stats.valid).toBe(2);
    expect(result.stats.invalid).toBe(0);
  });

  it('reports errors for missing fields', () => {
    const data = [
      { instruction: 'What is AI?' },
      { instruction: 'Explain ML', output: 'ML is...' },
    ];
    const result = validateRequiredFields(data, ['instruction', 'output']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(0);
    expect(result.errors[0].field).toBe('output');
    expect(result.stats.valid).toBe(1);
    expect(result.stats.invalid).toBe(1);
  });

  it('treats empty strings as invalid by default', () => {
    const data = [{ instruction: '', output: 'test' }];
    const result = validateRequiredFields(data, ['instruction']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('allows empty strings when allowEmptyStrings is true', () => {
    const data = [{ instruction: '', output: 'test' }];
    const result = validateRequiredFields(data, ['instruction'], { allowEmptyStrings: true });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('trims strings before validation by default', () => {
    const data = [{ instruction: '   ', output: 'test' }];
    const result = validateRequiredFields(data, ['instruction']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('does not trim strings when trimStrings is false', () => {
    const data = [{ instruction: '   ', output: 'test' }];
    const result = validateRequiredFields(data, ['instruction'], { trimStrings: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports null values as invalid', () => {
    const data = [{ instruction: null, output: 'test' }];
    const result = validateRequiredFields(data, ['instruction']);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('null');
  });

  it('reports undefined values as invalid', () => {
    const data = [{ output: 'test' }];
    const result = validateRequiredFields(data, ['instruction']);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('undefined');
  });

  it('returns correct stats for total records', () => {
    const data = [
      { instruction: 'A', output: 'B' },
      { instruction: '', output: 'C' },
      { output: 'D' },
    ];
    const result = validateRequiredFields(data, ['instruction', 'output']);
    expect(result.stats.total).toBe(3);
    expect(result.stats.valid).toBe(1);
    expect(result.stats.invalid).toBe(2);
  });
});

describe('validateTypes', () => {
  it('validates correct types without errors', () => {
    const data = [
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
    ];
    const result = validateTypes(data, { name: 'string', age: 'number', active: 'boolean' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports type mismatches', () => {
    const data = [{ name: 123, age: 'not a number' }];
    const result = validateTypes(data, { name: 'string', age: 'number' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('validates array types', () => {
    const data = [{ tags: ['a', 'b'], meta: { key: 'val' } }];
    const result = validateTypes(data, { tags: 'array', meta: 'object' });
    expect(result.valid).toBe(true);
  });

  it('distinguishes arrays from objects', () => {
    const data = [{ tags: ['a', 'b'] }];
    const result = validateTypes(data, { tags: 'object' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('array');
  });

  it('skips null and undefined values', () => {
    const data = [{ name: null }, { name: undefined }];
    const result = validateTypes(data, { name: 'string' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates multiple fields and tracks per-record validity', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 'twenty' },
      { name: 123, age: 25 },
    ];
    const result = validateTypes(data, { name: 'string', age: 'number' });
    expect(result.stats.valid).toBe(1);
    expect(result.stats.invalid).toBe(2);
  });
});

describe('validateEmails', () => {
  it('validates correct email addresses', () => {
    const data = [{ email: 'user@example.com' }, { email: 'test.name@domain.org' }];
    const result = validateEmails(data, ['email']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports invalid email addresses', () => {
    const data = [
      { email: 'not-an-email' },
      { email: 'missing@domain' },
      { email: '@nodomain.com' },
    ];
    const result = validateEmails(data, ['email']);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('skips records with empty email fields', () => {
    const data = [{ email: '' }, { email: null }, { name: 'no email' }];
    const result = validateEmails(data, ['email']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validateUrls', () => {
  it('validates correct URLs', () => {
    const data = [{ url: 'https://example.com' }, { url: 'http://test.org/path?q=1' }];
    const result = validateUrls(data, ['url']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports invalid URLs', () => {
    const data = [{ url: 'not-a-url' }, { url: 'ftp//missing-colon' }];
    const result = validateUrls(data, ['url']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('skips empty URL fields', () => {
    const data = [{ url: '' }, { url: null }];
    const result = validateUrls(data, ['url']);
    expect(result.valid).toBe(true);
  });
});

describe('validateDates', () => {
  it('validates ISO date strings', () => {
    const data = [{ date: '2025-01-15' }, { date: '2024-06-20T10:30:00Z' }];
    const result = validateDates(data, ['date'], 'iso');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports invalid date strings', () => {
    const data = [{ date: 'not-a-date' }, { date: 'abc123' }];
    const result = validateDates(data, ['date'], 'iso');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('validates timestamps when format is timestamp', () => {
    const data = [{ date: 1706000000 }, { date: Date.now() }];
    const result = validateDates(data, ['date'], 'timestamp');
    expect(result.valid).toBe(true);
  });

  it('rejects non-number values for timestamp format', () => {
    const data = [{ date: '2025-01-15' }];
    const result = validateDates(data, ['date'], 'timestamp');
    expect(result.valid).toBe(false);
  });

  it('validates any parseable date when format is any', () => {
    const data = [{ date: '2025-01-15' }, { date: 'January 15, 2025' }];
    const result = validateDates(data, ['date'], 'any');
    expect(result.valid).toBe(true);
  });

  it('skips null/empty date values', () => {
    const data = [{ date: null }, { date: undefined }];
    const result = validateDates(data, ['date']);
    expect(result.valid).toBe(true);
  });
});

describe('validateRanges', () => {
  it('validates values within range', () => {
    const data = [{ score: 50 }, { score: 75 }, { score: 100 }];
    const result = validateRanges(data, { score: { min: 0, max: 100 } });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports values below minimum', () => {
    const data = [{ score: -5 }];
    const result = validateRanges(data, { score: { min: 0 } });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('below minimum');
  });

  it('reports values above maximum', () => {
    const data = [{ score: 150 }];
    const result = validateRanges(data, { score: { max: 100 } });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('above maximum');
  });

  it('reports non-numeric values', () => {
    const data = [{ score: 'high' }];
    const result = validateRanges(data, { score: { min: 0, max: 100 } });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('not a number');
  });

  it('skips null and undefined values', () => {
    const data = [{ score: null }, { score: undefined }];
    const result = validateRanges(data, { score: { min: 0 } });
    expect(result.valid).toBe(true);
  });
});

describe('validateWithZod', () => {
  it('validates data matching the schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const result = validateWithZod(data, schema);
    expect(result.valid).toBe(true);
    expect(result.stats.valid).toBe(2);
  });

  it('reports errors for invalid data', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const data = [
      { name: 'Alice', age: 30 },
      { name: 123, age: 'not a number' },
    ];
    const result = validateWithZod(data, schema);
    expect(result.valid).toBe(false);
    expect(result.stats.valid).toBe(1);
    expect(result.stats.invalid).toBe(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('returns field path in error', () => {
    const schema = z.object({
      name: z.string(),
    });
    const data = [{ name: 42 }];
    const result = validateWithZod(data, schema);
    expect(result.errors[0].field).toBe('name');
  });
});

describe('createSchemaFromTypeMap', () => {
  it('creates a Zod schema from a type map with string type', () => {
    const schema = createSchemaFromTypeMap({ name: 'string' });
    const valid = schema.safeParse({ name: 'Alice' });
    const invalid = schema.safeParse({ name: 123 });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('creates a Zod schema from a type map with number type', () => {
    const schema = createSchemaFromTypeMap({ age: 'number' });
    const valid = schema.safeParse({ age: 30 });
    const invalid = schema.safeParse({ age: 'thirty' });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('creates a Zod schema with email type', () => {
    const schema = createSchemaFromTypeMap({ email: 'email' });
    const valid = schema.safeParse({ email: 'test@example.com' });
    const invalid = schema.safeParse({ email: 'not-an-email' });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('creates a Zod schema with url type', () => {
    const schema = createSchemaFromTypeMap({ website: 'url' });
    const valid = schema.safeParse({ website: 'https://example.com' });
    const invalid = schema.safeParse({ website: 'not-a-url' });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('passes through extra fields with passthrough', () => {
    const schema = createSchemaFromTypeMap({ name: 'string' });
    const result = schema.safeParse({ name: 'Alice', extra: 'field' });
    expect(result.success).toBe(true);
  });
});
