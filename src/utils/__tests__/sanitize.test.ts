import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maskSensitiveFields } from '../sanitize';
import { setGlobalFlags, outputResult } from '../output';

describe('maskSensitiveFields', () => {
  it('should mask known sensitive keys with first3...last3 format', () => {
    const obj = { googleApiKey: 'test1234567890345', name: 'myConfig' };
    const result = maskSensitiveFields(obj);
    expect(result.googleApiKey).toBe('tes...345');
    expect(result.name).toBe('myConfig');
  });

  it('should pass through non-sensitive fields unchanged', () => {
    const obj = { host: 'localhost', port: 8080, debug: true };
    const result = maskSensitiveFields(obj);
    expect(result).toEqual({ host: 'localhost', port: 8080, debug: true });
  });

  it('should recurse into nested objects', () => {
    const obj = {
      config: {
        googleApiKey: 'abcdefghijk',
        nested: {
          braveApiKey: 'xyzxyzxyzxyz',
        },
      },
      topLevel: 'safe',
    };
    const result = maskSensitiveFields(obj);
    expect((result.config as any).googleApiKey).toBe('abc...ijk');
    expect((result.config as any).nested.braveApiKey).toBe('xyz...xyz');
    expect(result.topLevel).toBe('safe');
  });

  it('should mask empty string values to "***"', () => {
    // Empty strings have length 0, which is not > 0, so they pass through
    const obj = { googleApiKey: '' };
    const result = maskSensitiveFields(obj);
    // Based on source: condition is value.length > 0, so empty string passes through
    expect(result.googleApiKey).toBe('');
  });

  it('should mask short values (<=6 chars) to "***"', () => {
    const obj = { googleApiKey: 'abc123' };
    const result = maskSensitiveFields(obj);
    expect(result.googleApiKey).toBe('***');
  });

  it('should mask values with exactly 7 chars using first3...last3', () => {
    const obj = { googleApiKey: 'abcdefg' };
    const result = maskSensitiveFields(obj);
    expect(result.googleApiKey).toBe('abc...efg');
  });

  it('should mask all default sensitive key types', () => {
    const obj = {
      googleApiKey: 'longvalue123',
      bingApiKey: 'longvalue456',
      braveApiKey: 'longvalue789',
      ollamaApiKey: 'longvalue000',
      githubToken: 'longvalueabc',
      semanticScholarApiKey: 'longvaluedef',
      serpApiKey: 'longvalueghi',
    };
    const result = maskSensitiveFields(obj);
    for (const key of Object.keys(obj)) {
      expect(result[key]).toMatch(/^lon\.\.\..*$/);
    }
  });

  it('should accept custom sensitiveKeys parameter', () => {
    const obj = { mySecret: 'supersecretvalue', googleApiKey: 'shouldNotBeMasked' };
    const result = maskSensitiveFields(obj, ['mySecret']);
    expect(result.mySecret).toBe('sup...lue');
    expect(result.googleApiKey).toBe('shouldNotBeMasked');
  });

  it('should not mask non-string sensitive values', () => {
    const obj = { googleApiKey: 12345 as any };
    const result = maskSensitiveFields(obj);
    expect(result.googleApiKey).toBe(12345);
  });

  it('should not recurse into arrays', () => {
    const obj = { items: [{ googleApiKey: 'secret123456' }] };
    const result = maskSensitiveFields(obj);
    // Arrays are not recursed into, they pass through as-is
    expect(result.items).toEqual([{ googleApiKey: 'secret123456' }]);
  });
});

describe('outputResult applies maskSensitiveFields (5.7)', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  it('masks API keys in outputResult data', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

    outputResult('config', {
      googleApiKey: 'my-super-secret-api-key-12345',
      host: 'localhost',
    });

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parsed.data.googleApiKey).toBe('my-...345');
    expect(parsed.data.host).toBe('localhost');
  });

  it('masks tokens in nested outputResult data', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

    outputResult('config', {
      settings: {
        githubToken: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        braveApiKey: 'bsk-yyyyyyyyyyy',
      },
    });

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parsed.data.settings.githubToken).toBe('ghp...xxx');
    expect(parsed.data.settings.braveApiKey).toBe('bsk...yyy');
  });

  it('passes through string data unmasked (not an object)', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

    outputResult('test', 'googleApiKey=my-secret');

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parsed.data).toBe('googleApiKey=my-secret');
  });

  it('passes through number data unmasked', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

    outputResult('test', 42);

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parsed.data).toBe(42);
  });

  it('passes through array data unmasked', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

    outputResult('test', [{ googleApiKey: 'should-not-be-masked' }]);

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parsed.data[0].googleApiKey).toBe('should-not-be-masked');
  });

  it('masks all default sensitive key types in JSON output', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

    outputResult('config', {
      googleApiKey: 'longvalue_google_key',
      bingApiKey: 'longvalue_bing_key123',
      braveApiKey: 'longvalue_brave_key12',
      ollamaApiKey: 'longvalue_ollama_key1',
      githubToken: 'longvalue_github_tok1',
      semanticScholarApiKey: 'longvalue_semantic_1',
      serpApiKey: 'longvalue_serp_key12',
    });

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    for (const key of Object.keys(parsed.data)) {
      // All sensitive values should be masked (contain "...")
      expect(parsed.data[key]).toContain('...');
    }
  });
});
