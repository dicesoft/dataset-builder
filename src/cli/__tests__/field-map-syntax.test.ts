import { describe, it, expect } from 'vitest';

/**
 * Replicates the field-map parsing logic from format.ts
 * to test both JSON and shorthand formats independently.
 */
function parseFieldMap(input: string): Record<string, string> {
  try {
    return JSON.parse(input);
  } catch {
    // Try shorthand: key:value,key:value
    const pairs = input.split(',');
    const parsed: Record<string, string> = {};
    let valid = true;
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) {
        valid = false;
        break;
      }
      const key = pair.slice(0, colonIdx).trim();
      const value = pair.slice(colonIdx + 1).trim();
      if (key && value) parsed[key] = value;
      else {
        valid = false;
        break;
      }
    }
    if (valid && Object.keys(parsed).length > 0) {
      return parsed;
    }
    throw new Error('Invalid field-map format');
  }
}

describe('--field-map parsing', () => {
  it('should parse valid JSON format', () => {
    const result = parseFieldMap('{"q":"instruction","a":"output"}');
    expect(result).toEqual({ q: 'instruction', a: 'output' });
  });

  it('should parse shorthand key:value,key:value format', () => {
    const result = parseFieldMap('q:instruction,a:output');
    expect(result).toEqual({ q: 'instruction', a: 'output' });
  });

  it('should parse single key:value pair', () => {
    const result = parseFieldMap('question:instruction');
    expect(result).toEqual({ question: 'instruction' });
  });

  it('should handle whitespace in shorthand format', () => {
    const result = parseFieldMap('q : instruction , a : output');
    expect(result).toEqual({ q: 'instruction', a: 'output' });
  });

  it('should handle values containing colons', () => {
    // First colon splits key from value, rest belongs to value
    const result = parseFieldMap('url:http://example.com');
    expect(result).toEqual({ url: 'http://example.com' });
  });

  it('should reject invalid shorthand missing colons', () => {
    expect(() => parseFieldMap('invalid')).toThrow('Invalid field-map format');
  });

  it('should reject empty key', () => {
    expect(() => parseFieldMap(':value')).toThrow('Invalid field-map format');
  });

  it('should reject empty value', () => {
    expect(() => parseFieldMap('key:')).toThrow('Invalid field-map format');
  });

  it('should reject completely empty input', () => {
    expect(() => parseFieldMap('')).toThrow('Invalid field-map format');
  });

  it('should prefer JSON when input is valid JSON', () => {
    const jsonInput = '{"complex key":"value with spaces"}';
    const result = parseFieldMap(jsonInput);
    expect(result).toEqual({ 'complex key': 'value with spaces' });
  });
});
