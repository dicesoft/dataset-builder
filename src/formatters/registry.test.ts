import { describe, it, expect, beforeEach } from 'vitest';
import type { Formatter, FormatOptions } from './types';
import {
  registerFormatter,
  getFormatter,
  hasFormatter,
  listFormatters,
  getFormattersByCategory,
  unregisterFormatter,
  clearRegistry,
  getFormatterCount,
} from './registry';

/**
 * Helper: create a minimal mock formatter for testing
 */
function createMockFormatter(name: string, description = `${name} formatter`): Formatter {
  return {
    name,
    description,
    supportedInputFormats: ['json'],
    validate: () => ({ valid: true, errors: [] }),
    format: async () => ({
      outputDir: '/out',
      files: {},
      metadata: {
        formatter: name,
        datasetName: 'test',
        timestamp: Date.now(),
        counts: { train: 0, validation: 0, test: 0, total: 0 },
      },
    }),
  };
}

describe('formatter registry', () => {
  // Clear auto-registered formatters before each test
  beforeEach(() => {
    clearRegistry();
  });

  it('should register and retrieve a formatter', () => {
    const formatter = createMockFormatter('test-fmt');
    registerFormatter('test-fmt', formatter);

    const retrieved = getFormatter('test-fmt');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('test-fmt');
  });

  it('hasFormatter should return true for registered and false for unknown', () => {
    expect(hasFormatter('nope')).toBe(false);

    registerFormatter('exists', createMockFormatter('exists'));
    expect(hasFormatter('exists')).toBe(true);
  });

  it('listFormatters should return name and description for each registered', () => {
    registerFormatter('alpha', createMockFormatter('alpha', 'Alpha description'));
    registerFormatter('beta', createMockFormatter('beta', 'Beta description'));

    const list = listFormatters();
    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        { name: 'alpha', description: 'Alpha description' },
        { name: 'beta', description: 'Beta description' },
      ])
    );
  });

  it('getFormattersByCategory should group formatters correctly', () => {
    // Register one formatter per category to verify grouping logic
    registerFormatter('chatml', createMockFormatter('chatml'));
    registerFormatter('llava', createMockFormatter('llava'));
    registerFormatter('audiofolder', createMockFormatter('audiofolder'));
    registerFormatter('datasetdict', createMockFormatter('datasetdict'));

    const cats = getFormattersByCategory();
    expect(cats.text.some((f) => f.name === 'chatml')).toBe(true);
    expect(cats.vision.some((f) => f.name === 'llava')).toBe(true);
    expect(cats.audio.some((f) => f.name === 'audiofolder')).toBe(true);
    expect(cats.huggingface.some((f) => f.name === 'datasetdict')).toBe(true);
  });

  it('unregisterFormatter should remove a formatter', () => {
    registerFormatter('removable', createMockFormatter('removable'));
    expect(hasFormatter('removable')).toBe(true);

    const removed = unregisterFormatter('removable');
    expect(removed).toBe(true);
    expect(hasFormatter('removable')).toBe(false);
  });

  it('unregisterFormatter should return false for non-existent formatter', () => {
    expect(unregisterFormatter('ghost')).toBe(false);
  });

  it('clearRegistry should remove all formatters', () => {
    registerFormatter('a', createMockFormatter('a'));
    registerFormatter('b', createMockFormatter('b'));
    expect(getFormatterCount()).toBe(2);

    clearRegistry();
    expect(getFormatterCount()).toBe(0);
    expect(listFormatters()).toHaveLength(0);
  });

  it('getFormatterCount should return the accurate count', () => {
    expect(getFormatterCount()).toBe(0);

    registerFormatter('one', createMockFormatter('one'));
    expect(getFormatterCount()).toBe(1);

    registerFormatter('two', createMockFormatter('two'));
    expect(getFormatterCount()).toBe(2);
  });

  it('should overwrite on duplicate registration', () => {
    registerFormatter('dup', createMockFormatter('dup', 'original'));
    registerFormatter('dup', createMockFormatter('dup', 'replaced'));

    const f = getFormatter('dup');
    expect(f!.description).toBe('replaced');
    expect(getFormatterCount()).toBe(1);
  });
});
