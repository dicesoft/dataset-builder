import { describe, it, expect } from 'vitest';
import { sanitizeSpiderUrl } from '../runner';
import { CLIError } from '../../utils/errorCodes';

describe('sanitizeSpiderUrl', () => {
  it('should pass through normal URLs unchanged except for escaping', () => {
    const result = sanitizeSpiderUrl('https://example.com/page');
    expect(result).toBe('https://example.com/page');
  });

  it('should escape double quotes in URLs', () => {
    const result = sanitizeSpiderUrl('https://example.com/search?q="test"');
    expect(result).toBe('https://example.com/search?q=\\"test\\"');
  });

  it('should escape backslashes in URLs', () => {
    const result = sanitizeSpiderUrl('https://example.com/path\\file');
    expect(result).toBe('https://example.com/path\\\\file');
  });

  it('should escape both backslashes and quotes', () => {
    const result = sanitizeSpiderUrl('https://example.com/a\\b"c');
    expect(result).toBe('https://example.com/a\\\\b\\"c');
  });

  it('should reject URLs with null bytes', () => {
    expect(() => sanitizeSpiderUrl('https://example.com/\0evil')).toThrow(CLIError);
    try {
      sanitizeSpiderUrl('https://example.com/\0evil');
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.message).toContain('null bytes');
    }
  });

  it('should reject URLs with triple quotes', () => {
    expect(() => sanitizeSpiderUrl('https://example.com/"""injection')).toThrow(CLIError);
    try {
      sanitizeSpiderUrl('https://example.com/"""injection');
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.message).toContain('triple-quote');
    }
  });

  it('should reject URLs with Unicode escape sequences', () => {
    expect(() => sanitizeSpiderUrl('https://example.com/\\u0041test')).toThrow(CLIError);
    try {
      sanitizeSpiderUrl('https://example.com/\\u0041test');
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.message).toContain('Unicode escape');
    }
  });

  it('should reject URLs exceeding 2000 characters', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2000);
    expect(() => sanitizeSpiderUrl(longUrl)).toThrow(CLIError);
    try {
      sanitizeSpiderUrl(longUrl);
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
      expect(cliErr.message).toContain('2000');
    }
  });

  it('should allow URLs at exactly 2000 characters', () => {
    const url = 'https://example.com/' + 'a'.repeat(1980);
    expect(url.length).toBe(2000);
    // Should not throw
    const result = sanitizeSpiderUrl(url);
    expect(result).toBe(url);
  });
});
