import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setGlobalFlags,
  getGlobalFlags,
  isJsonMode,
  isQuietMode,
  isYesMode,
  outputResult,
  outputError,
} from '../output';

describe('output', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    delete process.env.JSON_OUTPUT;
    delete process.env.DATASET_BUILDER_JSON;
    delete process.env.QUIET;
    delete process.env.DATASET_BUILDER_QUIET;
    delete process.env.YES;
    delete process.env.CI;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  describe('setGlobalFlags / getGlobalFlags', () => {
    it('should store and return flags', () => {
      const flags = { json: true, quiet: false, yes: true, verbose: false, dryRun: false };
      setGlobalFlags(flags);
      expect(getGlobalFlags()).toEqual(flags);
    });

    it('should not be affected by mutations to the original object', () => {
      const flags = { json: true, quiet: false, yes: false, verbose: false, dryRun: false };
      setGlobalFlags(flags);
      flags.json = false;
      expect(getGlobalFlags().json).toBe(true);
    });
  });

  describe('isJsonMode', () => {
    it('should return false by default', () => {
      expect(isJsonMode()).toBe(false);
    });

    it('should return true when json flag is set', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      expect(isJsonMode()).toBe(true);
    });

    it('should return true when JSON_OUTPUT env is set', () => {
      process.env.JSON_OUTPUT = 'true';
      expect(isJsonMode()).toBe(true);
    });

    it('should return true when DATASET_BUILDER_JSON env is set', () => {
      process.env.DATASET_BUILDER_JSON = '1';
      expect(isJsonMode()).toBe(true);
    });
  });

  describe('isQuietMode', () => {
    it('should return false by default', () => {
      expect(isQuietMode()).toBe(false);
    });

    it('should return true when quiet flag is set', () => {
      setGlobalFlags({ json: false, quiet: true, yes: false, verbose: false, dryRun: false });
      expect(isQuietMode()).toBe(true);
    });

    it('should return true when QUIET env is set', () => {
      process.env.QUIET = 'true';
      expect(isQuietMode()).toBe(true);
    });

    it('should return true when DATASET_BUILDER_QUIET env is set', () => {
      process.env.DATASET_BUILDER_QUIET = '1';
      expect(isQuietMode()).toBe(true);
    });
  });

  describe('isYesMode', () => {
    it('should return false by default', () => {
      expect(isYesMode()).toBe(false);
    });

    it('should return true when yes flag is set', () => {
      setGlobalFlags({ json: false, quiet: false, yes: true, verbose: false, dryRun: false });
      expect(isYesMode()).toBe(true);
    });

    it('should return true when YES env is set', () => {
      process.env.YES = 'true';
      expect(isYesMode()).toBe(true);
    });

    it('should return true when CI env is set', () => {
      process.env.CI = 'true';
      expect(isYesMode()).toBe(true);
    });
  });

  describe('outputResult', () => {
    it('should write JSON envelope to stdout in JSON mode', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputResult('scrape', { records: 42 }, { duration_ms: 1234 });

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output).toEqual({
        version: 1,
        success: true,
        command: 'scrape',
        data: { records: 42 },
        stats: { duration_ms: 1234 },
      });
    });

    it('should omit stats when not provided', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputResult('generate', { count: 10 });

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.stats).toBeUndefined();
    });

    it('should be no-op when not in JSON mode', () => {
      setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
      outputResult('scrape', { records: 42 });
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('outputError', () => {
    it('should write error JSON to stdout in JSON mode', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputError('INVALID_INPUT', 'Missing --input flag', { flag: 'input' });

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output).toEqual({
        version: 1,
        error: true,
        code: 'INVALID_INPUT',
        message: 'Missing --input flag',
        details: { flag: 'input' },
      });
    });

    it('should omit details when not provided', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputError('GENERAL_ERROR', 'Something went wrong');

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.details).toBeUndefined();
    });

    it('should be no-op when not in JSON mode', () => {
      setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
      outputError('GENERAL_ERROR', 'Something went wrong');
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('circular reference / large data (5.6)', () => {
    it('outputResult with circular reference in array data should NOT throw', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      // Use array data to skip maskSensitiveFields (which doesn't handle circular refs)
      const arr: unknown[] = [1, 2];
      arr.push(arr); // circular reference in array

      expect(() => outputResult('test', arr)).not.toThrow();
      expect(writeSpy).toHaveBeenCalledTimes(1);

      // Should produce valid JSON with [Circular] placeholder
      const raw = (writeSpy.mock.calls[0][0] as string).trim();
      const parsed = JSON.parse(raw);
      expect(parsed.success).toBe(true);
      expect(parsed.data[2]).toBe('[Circular]');
    });

    it('outputResult with large data object should complete', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      // Create a large object with many keys
      const bigData: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        bigData[`key_${i}`] = `value_${i}_${'x'.repeat(50)}`;
      }

      expect(() => outputResult('big-test', bigData)).not.toThrow();
      expect(writeSpy).toHaveBeenCalledTimes(1);

      const raw = (writeSpy.mock.calls[0][0] as string).trim();
      const parsed = JSON.parse(raw);
      expect(parsed.success).toBe(true);
      expect(Object.keys(parsed.data).length).toBe(10000);
    });

    it('outputError with special characters produces valid JSON', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

      const specialMessage =
        'Error: "quotes" and \'apostrophes\' and\nnewlines\tand\ttabs and unicode: 你好 🎉';
      expect(() => outputError('GENERAL_ERROR', specialMessage)).not.toThrow();
      expect(writeSpy).toHaveBeenCalledTimes(1);

      const raw = (writeSpy.mock.calls[0][0] as string).trim();
      const parsed = JSON.parse(raw);
      expect(parsed.error).toBe(true);
      expect(parsed.message).toBe(specialMessage);
    });

    it('outputResult with deeply nested data should complete', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

      // Build deeply nested structure
      let nested: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 50; i++) {
        nested = { child: nested };
      }

      expect(() => outputResult('nested-test', nested)).not.toThrow();
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    it('outputResult with null and undefined values should produce valid JSON', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });

      outputResult('nulls', { a: null, b: undefined, c: 0, d: false, e: '' });
      const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(parsed.data.a).toBeNull();
      expect(parsed.data.b).toBeUndefined();
      expect(parsed.data.c).toBe(0);
      expect(parsed.data.d).toBe(false);
      expect(parsed.data.e).toBe('');
    });
  });

  describe('non-object data passthrough (5.6)', () => {
    it('outputResult with string data passes through unmodified', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputResult('test', 'simple string');
      const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(parsed.data).toBe('simple string');
    });

    it('outputResult with number data passes through unmodified', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputResult('test', 42);
      const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(parsed.data).toBe(42);
    });

    it('outputResult with array data passes through unmodified', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      outputResult('test', [1, 2, 3]);
      const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(parsed.data).toEqual([1, 2, 3]);
    });
  });
});
