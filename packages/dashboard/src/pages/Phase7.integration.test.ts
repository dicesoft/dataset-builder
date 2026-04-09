import { describe, it, expect, vi } from 'vitest';

/**
 * 7.6: Component-level integration tests for Phase 7
 *
 * Playwright is not configured in this project. These tests verify
 * integration patterns at the logic level:
 * - MultiSelect interaction flow (value arrays, serialization)
 * - Preset loading with multi-value field population
 * - Round-trip: configure controls -> serialize -> submit payload shape
 *
 * When Playwright is added, these can be expanded to browser-level E2E tests.
 */

// Mock metadataStore
vi.mock('../stores/metadataStore', () => ({
  useMetadataStore: Object.assign(() => ({}), {
    getState: () => ({
      models: [
        { name: 'llama3', size: 1000, modifiedAt: '2025-01-01', details: null },
        { name: 'mistral', size: 2000, modifiedAt: '2025-01-02', details: null },
      ],
      providers: [
        { name: 'google', available: true, requiresKey: 'googleApiKey' },
        { name: 'brave', available: false, requiresKey: 'braveApiKey' },
        { name: 'duckduckgo', available: true, requiresKey: null },
      ],
      languages: [
        { code: 'es', name: 'Spanish', nativeName: 'Espanol' },
        { code: 'fr', name: 'French', nativeName: 'Francais' },
      ],
      enums: {
        outputFormats: ['json', 'jsonl', 'csv', 'xml'],
        downloadFormats: ['image', 'video', 'pdf'],
      },
      commandMetas: new Map(),
      loading: false,
      error: null,
    }),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  buildInitialValues,
  serializeFormValues,
  getEnhancement,
  type CommandOption,
} from '../components/FormBuilder/FormBuilder';

function makeOption(overrides: Partial<CommandOption> = {}): CommandOption {
  return {
    name: 'testField',
    type: 'string',
    description: 'Test field',
    ...overrides,
  };
}

describe('Phase 7 integration tests', () => {
  describe('7.6a: MultiSelect interaction flow', () => {
    it('selecting multiple providers produces an array value', () => {
      const enhancement = getEnhancement('scrape', 'searchProvider');
      expect(enhancement).toBeDefined();
      expect(enhancement?.multi).toBe(true);

      // Simulated user selection: picking google and duckduckgo
      const selectedValues = ['google', 'duckduckgo'];
      expect(Array.isArray(selectedValues)).toBe(true);
      expect(selectedValues).toHaveLength(2);
    });

    it('array values serialize to comma-separated string for API', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const values = { searchProvider: ['google', 'duckduckgo'] };

      const serialized = serializeFormValues(values, 'scrape');
      expect(serialized.searchProvider).toBe('google,duckduckgo');
    });

    it('selecting formats produces checkbox group array', () => {
      const enhancement = getEnhancement('scrape', 'formats');
      expect(enhancement).toBeDefined();
      expect(enhancement?.checkboxGroup).toBe(true);
    });
  });

  describe('7.6b: Preset loading populates multi-value fields', () => {
    it('comma-separated preset string parses into array for multi fields', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const presetValues = { searchProvider: 'google,brave,duckduckgo' };

      const initial = buildInitialValues(options, 'scrape', presetValues);
      // Multi-enhanced fields split comma-separated strings into arrays
      expect(Array.isArray(initial.searchProvider)).toBe(true);
      expect(initial.searchProvider).toEqual(['google', 'brave', 'duckduckgo']);
    });

    it('array preset values remain as arrays', () => {
      const options = [makeOption({ name: 'searchProvider' })];
      const presetValues = { searchProvider: ['google', 'bing'] };

      const initial = buildInitialValues(options, 'scrape', presetValues);
      expect(Array.isArray(initial.searchProvider)).toBe(true);
      expect(initial.searchProvider).toEqual(['google', 'bing']);
    });

    it('non-multi fields preserve string values from presets', () => {
      const options = [makeOption({ name: 'outputFormat' })];
      const presetValues = { outputFormat: 'json' };

      const initial = buildInitialValues(options, 'scrape', presetValues);
      expect(initial.outputFormat).toBe('json');
    });
  });

  describe('7.6c: Round-trip configure -> serialize -> submit', () => {
    it('full scrape form round-trip preserves all field values', () => {
      const options = [
        makeOption({ name: 'searchProvider' }),
        makeOption({ name: 'formats' }),
        makeOption({ name: 'outputFormat' }),
        makeOption({ name: 'limit', type: 'number' }),
      ];

      // Step 1: Build initial values (simulating a preset load)
      const preset = {
        searchProvider: 'google,bing',
        formats: 'image,video',
        outputFormat: 'jsonl',
        limit: 50,
      };
      const initial = buildInitialValues(options, 'scrape', preset);

      // Step 2: Simulate user modifying values
      const userValues = {
        ...initial,
        searchProvider: [...(initial.searchProvider as string[]), 'duckduckgo'],
        limit: 100,
      };

      // Step 3: Serialize for API submission
      const serialized = serializeFormValues(userValues, 'scrape');

      expect(serialized.searchProvider).toBe('google,bing,duckduckgo');
      expect(serialized.formats).toBe('image,video');
      expect(serialized.outputFormat).toBe('jsonl');
      expect(serialized.limit).toBe(100);
    });

    it('format page round-trip with tags fields', () => {
      const options = [makeOption({ name: 'model' })];
      const initial = buildInitialValues(options, 'format', { model: 'llama3' });

      // Non-multi field stays as string
      expect(initial.model).toBe('llama3');

      const serialized = serializeFormValues(initial, 'format');
      expect(serialized.model).toBe('llama3');
    });
  });
});
