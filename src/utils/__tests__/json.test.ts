import { describe, it, expect } from 'vitest';
import { safeJsonParse, safeJsonlParse } from '../json';
import { CLIError } from '../errorCodes';
import { ExitCode } from '../exitCodes';

describe('safeJsonParse', () => {
  it('should return parsed value for valid JSON', () => {
    const result = safeJsonParse('{"key":"value","num":42}', 'test.json');
    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('should parse JSON arrays', () => {
    const result = safeJsonParse('[1,2,3]', 'test.json');
    expect(result).toEqual([1, 2, 3]);
  });

  it('should parse JSON primitives', () => {
    expect(safeJsonParse('"hello"', 'test.json')).toBe('hello');
    expect(safeJsonParse('123', 'test.json')).toBe(123);
    expect(safeJsonParse('null', 'test.json')).toBeNull();
    expect(safeJsonParse('true', 'test.json')).toBe(true);
  });

  it('should throw CLIError with source context for malformed JSON', () => {
    expect(() => safeJsonParse('{bad json}', 'config.json')).toThrow(CLIError);
    try {
      safeJsonParse('{bad json}', 'config.json');
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.exitCode).toBe(ExitCode.INVALID_INPUT);
      expect(cliErr.message).toContain('config.json');
    }
  });

  it('should throw CLIError for empty string', () => {
    expect(() => safeJsonParse('', 'empty.json')).toThrow(CLIError);
    try {
      safeJsonParse('', 'empty.json');
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.message).toContain('empty.json');
    }
  });
});

describe('safeJsonlParse', () => {
  it('should parse valid JSONL with multiple lines', () => {
    const input = '{"a":1}\n{"b":2}\n{"c":3}';
    const result = safeJsonlParse(input, 'data.jsonl');
    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('should filter out empty lines', () => {
    const input = '{"a":1}\n\n{"b":2}\n  \n{"c":3}\n';
    const result = safeJsonlParse(input, 'data.jsonl');
    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('should return empty array for empty input', () => {
    const result = safeJsonlParse('', 'empty.jsonl');
    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only input', () => {
    const result = safeJsonlParse('  \n  \n  ', 'empty.jsonl');
    expect(result).toEqual([]);
  });

  it('should throw CLIError with line number for bad line', () => {
    const input = '{"a":1}\n{bad}\n{"c":3}';
    expect(() => safeJsonlParse(input, 'data.jsonl')).toThrow(CLIError);
    try {
      safeJsonlParse(input, 'data.jsonl');
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.exitCode).toBe(ExitCode.INVALID_INPUT);
      expect(cliErr.message).toContain('data.jsonl');
      expect(cliErr.message).toContain('line 2');
    }
  });

  it('should report correct line number when empty lines are filtered', () => {
    // Empty lines are filtered, so the line number refers to the non-empty line index
    const input = '{"a":1}\n\n{bad}';
    try {
      safeJsonlParse(input, 'data.jsonl');
    } catch (err) {
      const cliErr = err as CLIError;
      // {bad} is the 2nd non-empty line, so line 2
      expect(cliErr.message).toContain('line 2');
    }
  });
});
