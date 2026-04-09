import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for FormBuilder exported functions:
 * - buildInitialValues: backward-compat parsing of comma-separated strings
 * - serializeFormValues: array-to-CSV serialization for multi/tags fields
 * - getEnhancement: field enhancement lookup
 */

// Mock metadataStore (needed by FormBuilder module import)
vi.mock('../../stores/metadataStore', () => ({
  useMetadataStore: Object.assign(() => ({}), {
    getState: () => ({
      models: [],
      providers: [],
      languages: [],
      enums: null,
    }),
  }),
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  buildInitialValues,
  serializeFormValues,
  getEnhancement,
  type CommandOption,
} from './FormBuilder';

function makeOption(overrides: Partial<CommandOption> = {}): CommandOption {
  return {
    name: 'testField',
    type: 'string',
    description: 'Test field',
    ...overrides,
  };
}

describe('FormBuilder functions', () => {
  describe('getEnhancement', () => {
    it('returns enhancement for known command.option key', () => {
      const e = getEnhancement('scrape', 'searchProvider');
      expect(e).toBeDefined();
      expect(e?.multi).toBe(true);
      expect(e?.dataSource).toBe('providers');
    });

    it('returns undefined for unknown command.option key', () => {
      expect(getEnhancement('unknown', 'unknown')).toBeUndefined();
    });

    it('returns model dataSource for generate.model', () => {
      const e = getEnhancement('generate', 'model');
      expect(e?.dataSource).toBe('models');
    });

    it('returns tags enhancement for transform.labels', () => {
      const e = getEnhancement('transform', 'labels');
      expect(e?.tags).toBe(true);
    });

    it('returns tags enhancement for clean.targetFields', () => {
      const e = getEnhancement('clean', 'targetFields');
      expect(e?.tags).toBe(true);
    });

    it('returns min/max for compress.crf', () => {
      const e = getEnhancement('compress', 'crf');
      expect(e?.min).toBe(0);
      expect(e?.max).toBe(51);
    });
  });

  describe('buildInitialValues', () => {
    it('returns default values for plain string fields', () => {
      const options = [makeOption({ name: 'query', defaultValue: 'test' })];
      const result = buildInitialValues(options, 'unknown');
      expect(result.query).toBe('test');
    });

    it('returns false for boolean fields with no default', () => {
      const options = [makeOption({ name: 'verbose', type: 'boolean' })];
      const result = buildInitialValues(options, 'unknown');
      expect(result.verbose).toBe(false);
    });

    it('returns empty string for number fields with no default', () => {
      const options = [makeOption({ name: 'count', type: 'number' })];
      const result = buildInitialValues(options, 'unknown');
      expect(result.count).toBe('');
    });

    it('parses comma-separated string into array for multi fields', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const result = buildInitialValues(options, 'scrape', {
        searchProvider: 'google,bing,brave',
      });
      expect(result.searchProvider).toEqual(['google', 'bing', 'brave']);
    });

    it('trims whitespace when parsing comma-separated strings', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const result = buildInitialValues(options, 'scrape', {
        searchProvider: 'google, bing , brave',
      });
      expect(result.searchProvider).toEqual(['google', 'bing', 'brave']);
    });

    it('passes through array values for multi fields', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const result = buildInitialValues(options, 'scrape', {
        searchProvider: ['google', 'bing'],
      });
      expect(result.searchProvider).toEqual(['google', 'bing']);
    });

    it('defaults to empty array for multi fields with no value', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const result = buildInitialValues(options, 'scrape');
      expect(result.searchProvider).toEqual([]);
    });

    it('parses comma-separated string into array for tags fields', () => {
      const options = [makeOption({ name: 'labels' })];
      const result = buildInitialValues(options, 'transform', {
        labels: 'question,answer,context',
      });
      expect(result.labels).toEqual(['question', 'answer', 'context']);
    });

    it('defaults to empty array for tags fields with no value', () => {
      const options = [makeOption({ name: 'labels' })];
      const result = buildInitialValues(options, 'transform');
      expect(result.labels).toEqual([]);
    });

    it('returns empty array when multi field value is empty string', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const result = buildInitialValues(options, 'scrape', { searchProvider: '' });
      expect(result.searchProvider).toEqual([]);
    });

    it('uses initialValues over defaults', () => {
      const options = [makeOption({ name: 'query', defaultValue: 'default' })];
      const result = buildInitialValues(options, 'unknown', { query: 'override' });
      expect(result.query).toBe('override');
    });

    it('uses opt.default when no initialValue provided', () => {
      const options = [makeOption({ name: 'format', default: 'json' })];
      const result = buildInitialValues(options, 'unknown');
      expect(result.format).toBe('json');
    });

    it('does not treat regular string fields as arrays', () => {
      const options = [makeOption({ name: 'query' })];
      const result = buildInitialValues(options, 'unknown', { query: 'hello,world' });
      expect(result.query).toBe('hello,world');
    });
  });

  describe('serializeFormValues', () => {
    it('joins multi-select arrays to comma-separated strings', () => {
      const result = serializeFormValues({ searchProvider: ['google', 'bing', 'brave'] }, 'scrape');
      expect(result.searchProvider).toBe('google,bing,brave');
    });

    it('joins tags arrays to comma-separated strings', () => {
      const result = serializeFormValues({ labels: ['question', 'answer'] }, 'transform');
      expect(result.labels).toBe('question,answer');
    });

    it('strips empty arrays', () => {
      const result = serializeFormValues({ searchProvider: [] }, 'scrape');
      expect(result).not.toHaveProperty('searchProvider');
    });

    it('strips empty strings', () => {
      const result = serializeFormValues({ query: '' }, 'scrape');
      expect(result).not.toHaveProperty('query');
    });

    it('strips null values', () => {
      const result = serializeFormValues({ query: null }, 'scrape');
      expect(result).not.toHaveProperty('query');
    });

    it('strips undefined values', () => {
      const result = serializeFormValues({ query: undefined }, 'scrape');
      expect(result).not.toHaveProperty('query');
    });

    it('passes through non-array values unchanged', () => {
      const result = serializeFormValues({ query: 'test', count: 10, verbose: true }, 'scrape');
      expect(result.query).toBe('test');
      expect(result.count).toBe(10);
      expect(result.verbose).toBe(true);
    });

    it('handles mixed field types in a single submission', () => {
      const result = serializeFormValues(
        {
          searchProvider: ['google', 'bing'],
          query: 'test query',
          count: 100,
          verbose: false,
          outputFormat: 'json',
          emptyField: '',
          emptyMulti: [],
        },
        'scrape'
      );
      expect(result).toEqual({
        searchProvider: 'google,bing',
        query: 'test query',
        count: 100,
        verbose: false,
        outputFormat: 'json',
      });
    });

    it('does not join arrays for fields without multi/tags enhancement', () => {
      const result = serializeFormValues({ someArray: ['a', 'b'] }, 'unknown');
      // No enhancement -> array stays as-is (but is non-empty so included)
      expect(result.someArray).toEqual(['a', 'b']);
    });
  });

  describe('buildInitialValues then serializeFormValues round-trip', () => {
    it('round-trips comma-separated preset through multi field', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const initial = buildInitialValues(options, 'scrape', {
        searchProvider: 'google,bing',
      });
      expect(initial.searchProvider).toEqual(['google', 'bing']);

      const serialized = serializeFormValues(initial, 'scrape');
      expect(serialized.searchProvider).toBe('google,bing');
    });

    it('round-trips comma-separated preset through tags field', () => {
      const options = [makeOption({ name: 'labels' })];
      const initial = buildInitialValues(options, 'transform', {
        labels: 'q,a',
      });
      expect(initial.labels).toEqual(['q', 'a']);

      const serialized = serializeFormValues(initial, 'transform');
      expect(serialized.labels).toBe('q,a');
    });

    it('round-trips empty multi field correctly', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const initial = buildInitialValues(options, 'scrape');
      expect(initial.searchProvider).toEqual([]);

      const serialized = serializeFormValues(initial, 'scrape');
      expect(serialized).not.toHaveProperty('searchProvider');
    });
  });

  describe('Phase 5: Dynamic Multi-Value Fields', () => {
    describe('5.1 — searchProvider MultiSelect with providers', () => {
      it('all providers selected produces correct CSV string', () => {
        const allProviders = ['google', 'bing', 'brave', 'duckduckgo', 'serpapi-google'];
        const result = serializeFormValues({ searchProvider: allProviders }, 'scrape');
        expect(result.searchProvider).toBe('google,bing,brave,duckduckgo,serpapi-google');
      });

      it('single provider selected produces plain string (no commas)', () => {
        const result = serializeFormValues({ searchProvider: ['google'] }, 'scrape');
        expect(result.searchProvider).toBe('google');
      });

      it('preset with single provider string loads into array', () => {
        const options = [makeOption({ name: 'searchProvider' })];
        const initial = buildInitialValues(options, 'scrape', {
          searchProvider: 'google',
        });
        expect(initial.searchProvider).toEqual(['google']);
      });
    });

    describe('5.2 — formats Checkbox.Group', () => {
      it('checkboxGroup field initializes as array from comma-separated string', () => {
        const options = [makeOption({ name: 'formats' })];
        const initial = buildInitialValues(options, 'scrape', {
          formats: 'image,video,pdf',
        });
        expect(initial.formats).toEqual(['image', 'video', 'pdf']);
      });

      it('checkboxGroup field serializes array to CSV', () => {
        const result = serializeFormValues(
          { formats: ['image', 'video', 'pdf', 'audio'] },
          'scrape'
        );
        expect(result.formats).toBe('image,video,pdf,audio');
      });

      it('empty checkboxGroup array is excluded from submission', () => {
        const result = serializeFormValues({ formats: [] }, 'scrape');
        expect(result).not.toHaveProperty('formats');
      });

      it('all 10 formats round-trip correctly', () => {
        const allFormats = [
          'image',
          'video',
          'pdf',
          'pptx',
          'docx',
          'csv',
          'audio',
          'archive',
          'spreadsheet',
          'document',
        ];
        const options = [makeOption({ name: 'formats' })];
        const initial = buildInitialValues(options, 'scrape', {
          formats: allFormats.join(','),
        });
        expect(initial.formats).toEqual(allFormats);

        const serialized = serializeFormValues(initial, 'scrape');
        expect(serialized.formats).toBe(allFormats.join(','));
      });

      it('getEnhancement returns checkboxGroup for scrape.formats', () => {
        const e = getEnhancement('scrape', 'formats');
        expect(e?.checkboxGroup).toBe(true);
        expect(e?.dataSource).toBe('enums');
      });
    });

    describe('5.3 — clean.targetFields TagsInput', () => {
      it('getEnhancement returns tags for clean.targetFields', () => {
        const e = getEnhancement('clean', 'targetFields');
        expect(e?.tags).toBe(true);
      });

      it('targetFields tags round-trip through buildInitialValues and serialize', () => {
        const options = [makeOption({ name: 'targetFields' })];
        const initial = buildInitialValues(options, 'clean', {
          targetFields: 'text,content,description',
        });
        expect(initial.targetFields).toEqual(['text', 'content', 'description']);

        const serialized = serializeFormValues(initial, 'clean');
        expect(serialized.targetFields).toBe('text,content,description');
      });
    });

    describe('5.4 — transform.labels TagsInput', () => {
      it('labels tags round-trip correctly', () => {
        const options = [makeOption({ name: 'labels' })];
        const initial = buildInitialValues(options, 'transform', {
          labels: 'question,answer,context',
        });
        expect(initial.labels).toEqual(['question', 'answer', 'context']);

        const serialized = serializeFormValues(initial, 'transform');
        expect(serialized.labels).toBe('question,answer,context');
      });
    });

    describe('5.5 — Preset loading with multi-value fields', () => {
      it('preset with comma-separated searchProvider loads into MultiSelect', () => {
        const options = [
          makeOption({ name: 'searchProvider' }),
          makeOption({ name: 'search' }),
          makeOption({ name: 'formats' }),
        ];
        const presetValues = {
          searchProvider: 'google,bing',
          search: 'cats',
          formats: 'image,video',
        };
        const initial = buildInitialValues(options, 'scrape', presetValues);
        expect(initial.searchProvider).toEqual(['google', 'bing']);
        expect(initial.search).toBe('cats');
        expect(initial.formats).toEqual(['image', 'video']);
      });

      it('preset with array values passes through correctly', () => {
        const options = [makeOption({ name: 'searchProvider' })];
        const initial = buildInitialValues(options, 'scrape', {
          searchProvider: ['brave', 'duckduckgo'],
        });
        expect(initial.searchProvider).toEqual(['brave', 'duckduckgo']);
      });
    });

    describe('5.6 — Config string integration', () => {
      it('config string value for multi field is parsed to array', () => {
        const options = [makeOption({ name: 'searchProvider' })];
        const initial = buildInitialValues(options, 'scrape', {
          searchProvider: 'google',
        });
        expect(initial.searchProvider).toEqual(['google']);
        // Serialize back
        const serialized = serializeFormValues(initial, 'scrape');
        expect(serialized.searchProvider).toBe('google');
      });

      it('config string value for checkboxGroup field is parsed to array', () => {
        const options = [makeOption({ name: 'formats' })];
        const initial = buildInitialValues(options, 'scrape', {
          formats: 'pdf,docx',
        });
        expect(initial.formats).toEqual(['pdf', 'docx']);
      });

      it('config string value for tags field is parsed to array', () => {
        const options = [makeOption({ name: 'labels' })];
        const initial = buildInitialValues(options, 'transform', {
          labels: 'instruction,response',
        });
        expect(initial.labels).toEqual(['instruction', 'response']);
      });
    });

    describe('5.7 — Full round-trip integration', () => {
      it('MultiSelect value → handleSubmit joins to CSV → correct string for POST', () => {
        const formValues = {
          searchProvider: ['google', 'bing', 'brave'],
          search: 'test query',
          searchCount: 50,
          download: true,
          formats: ['image', 'video'],
          outputFormat: 'jsonl',
        };
        const serialized = serializeFormValues(formValues, 'scrape');
        expect(serialized).toEqual({
          searchProvider: 'google,bing,brave',
          search: 'test query',
          searchCount: 50,
          download: true,
          formats: 'image,video',
          outputFormat: 'jsonl',
        });
      });

      it('empty multi-select submits correctly (excluded from options)', () => {
        const formValues = {
          searchProvider: [],
          search: 'test',
          formats: [],
        };
        const serialized = serializeFormValues(formValues, 'scrape');
        expect(serialized).toEqual({ search: 'test' });
        expect(serialized).not.toHaveProperty('searchProvider');
        expect(serialized).not.toHaveProperty('formats');
      });

      it('mixed multi/tags/checkboxGroup/plain fields serialize correctly', () => {
        const options = [
          makeOption({ name: 'searchProvider' }),
          makeOption({ name: 'formats' }),
          makeOption({ name: 'search' }),
          makeOption({ name: 'searchCount', type: 'number' }),
          makeOption({ name: 'download', type: 'boolean' }),
        ];
        const presetValues = {
          searchProvider: 'google,brave',
          formats: 'image,pdf,audio',
          search: 'cats',
          searchCount: 100,
          download: true,
        };
        // Step 1: Build initial values from preset (simulates preset loading)
        const initial = buildInitialValues(options, 'scrape', presetValues);
        expect(initial.searchProvider).toEqual(['google', 'brave']);
        expect(initial.formats).toEqual(['image', 'pdf', 'audio']);
        expect(initial.search).toBe('cats');
        expect(initial.searchCount).toBe(100);
        expect(initial.download).toBe(true);

        // Step 2: Serialize (simulates handleSubmit)
        const serialized = serializeFormValues(initial, 'scrape');
        expect(serialized).toEqual({
          searchProvider: 'google,brave',
          formats: 'image,pdf,audio',
          search: 'cats',
          searchCount: 100,
          download: true,
        });
      });
    });
  });
});
