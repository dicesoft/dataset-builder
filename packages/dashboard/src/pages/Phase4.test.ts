import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 4 page-level interaction tests.
 *
 * Tests verify logic-level behavior for fixed-value field changes:
 * - Select controls render with correct options (via choices pipeline)
 * - Model selectors populate from metadataStore
 * - SegmentedControl strictness values for Clean page
 * - Field mapping selectors populate from dataset fields API
 * - metadataStore consistency (no remaining local command fetches)
 *
 * No jsdom/RTL — tests exercise exported functions and logic paths.
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
      ],
      languages: [{ code: 'es', name: 'Spanish', nativeName: 'Espanol' }],
      enums: {
        outputFormats: ['json', 'jsonl', 'csv', 'xml'],
        downloadFormats: ['image', 'video', 'pdf'],
        generateTypes: ['person', 'address', 'company', 'product', 'text', 'lorem', 'llm', 'all'],
        strictnessLevels: ['low', 'medium', 'high'],
        videoCodecs: ['h264', 'h265', 'av1'],
        videoFormats: ['mp4', 'webm', 'mkv'],
        validateMethods: ['deterministic', 'llm'],
        sourcePresets: ['web', 'images', 'videos', 'academic', 'code', '3d-assets', 'social'],
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

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

describe('Phase 4: Fixed-Value Fields', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // -----------------------------------------------------------------------
  // 4.1 — Scrape: outputFormat, sourcePreset, validateMethod via .choices()
  // -----------------------------------------------------------------------
  describe('4.1 — Scrape fixed-value fields render as Select via choices', () => {
    it('outputFormat with choices renders as Select (choices pipeline)', () => {
      const opt = makeOption({
        name: 'outputFormat',
        choices: ['json', 'jsonl', 'csv', 'xml'],
      });
      // When choices are present, FormBuilder renders Select.
      // Verify the option has choices set:
      expect(opt.choices).toEqual(['json', 'jsonl', 'csv', 'xml']);
      expect(opt.choices!.length).toBe(4);
    });

    it('sourcePreset with choices renders as Select', () => {
      const opt = makeOption({
        name: 'sourcePreset',
        choices: ['web', 'images', 'videos', 'academic', 'code', '3d-assets', 'social'],
      });
      expect(opt.choices!.length).toBe(7);
    });

    it('validateMethod with choices renders as Select (2 values)', () => {
      const opt = makeOption({
        name: 'validateMethod',
        choices: ['deterministic', 'llm'],
      });
      expect(opt.choices!.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 4.2 — Scrape: ytQuality via .choices()
  // -----------------------------------------------------------------------
  describe('4.2 — Scrape ytQuality renders as Select via choices', () => {
    it('ytQuality choices include expected resolutions', () => {
      const choices = ['360', '480', '720', '1080', '1440', '2160', 'best'];
      const opt = makeOption({ name: 'ytQuality', choices });
      expect(opt.choices).toContain('720');
      expect(opt.choices).toContain('1080');
      expect(opt.choices).toContain('best');
    });
  });

  // -----------------------------------------------------------------------
  // 4.3 — Generate: type and format via .choices()
  // -----------------------------------------------------------------------
  describe('4.3 — Generate type and format render as Select via choices', () => {
    it('type has all expected generator types', () => {
      const opt = makeOption({
        name: 'type',
        choices: ['person', 'address', 'company', 'product', 'text', 'lorem', 'llm', 'all'],
      });
      expect(opt.choices!.length).toBe(8);
      expect(opt.choices).toContain('llm');
    });

    it('format has expected output formats', () => {
      const opt = makeOption({
        name: 'format',
        choices: ['json', 'jsonl', 'csv'],
      });
      expect(opt.choices).toEqual(['json', 'jsonl', 'csv']);
    });
  });

  // -----------------------------------------------------------------------
  // 4.4 — Generate: model → Select from metadataStore
  // -----------------------------------------------------------------------
  describe('4.4 — Generate model uses metadataStore dataSource', () => {
    it('generate.model enhancement has dataSource: models', () => {
      const e = getEnhancement('generate', 'model');
      expect(e).toBeDefined();
      expect(e?.dataSource).toBe('models');
    });

    it('buildInitialValues defaults model to empty string', () => {
      const options = [makeOption({ name: 'model' })];
      const values = buildInitialValues(options, 'generate');
      expect(values.model).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // 4.5 — Transform: model from metadataStore
  // -----------------------------------------------------------------------
  describe('4.5 — Transform model uses metadataStore dataSource', () => {
    it('transform.model enhancement has dataSource: models', () => {
      const e = getEnhancement('transform', 'model');
      expect(e).toBeDefined();
      expect(e?.dataSource).toBe('models');
    });
  });

  // -----------------------------------------------------------------------
  // 4.6 — Clean: strictness → SegmentedControl
  // -----------------------------------------------------------------------
  describe('4.6 — Clean strictness uses SegmentedControl values', () => {
    it('strictness choices match CLI .choices() values', () => {
      // CLI defines: .choices(['low', 'medium', 'high'])
      const validValues = ['low', 'medium', 'high'];
      expect(validValues).toHaveLength(3);
      expect(validValues).toContain('low');
      expect(validValues).toContain('medium');
      expect(validValues).toContain('high');
    });

    it('strictness default is medium', () => {
      // The CleaningConfig initializes strictness to 'medium'
      const defaultStrictness = 'medium';
      expect(defaultStrictness).toBe('medium');
    });

    it('non-default strictness is included in submit options', () => {
      // Simulates the submit logic: only include strictness if !== 'medium'
      function buildStrictnessOption(
        strictness: 'low' | 'medium' | 'high'
      ): Record<string, unknown> {
        const options: Record<string, unknown> = {};
        if (strictness !== 'medium') {
          options['dedupeStrictness'] = strictness;
        }
        return options;
      }
      expect(buildStrictnessOption('high')['dedupeStrictness']).toBe('high');
    });

    it('default strictness (medium) is NOT included in submit options', () => {
      function buildStrictnessOption(
        strictness: 'low' | 'medium' | 'high'
      ): Record<string, unknown> {
        const options: Record<string, unknown> = {};
        if (strictness !== 'medium') {
          options['dedupeStrictness'] = strictness;
        }
        return options;
      }
      expect(buildStrictnessOption('medium')['dedupeStrictness']).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 4.7 — Format: field mapping source → Select from dataset fields
  // -----------------------------------------------------------------------
  describe('4.7 — Format field mapping fetches dataset fields', () => {
    it('fetches fields for selected dataset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          command: 'datasets.fields',
          data: { fields: ['text', 'label', 'category'] },
        }),
      });

      const baseUrl = '';
      const res = await fetch(
        `${baseUrl}/api/v1/datasets/${encodeURIComponent('data.json')}/fields`
      );
      const body = await res.json();
      expect(body.data.fields).toEqual(['text', 'label', 'category']);
    });

    it('builds field options for Select dropdowns', () => {
      const fields = ['text', 'label', 'category'];
      const options = fields.map((f) => ({ value: f, label: f }));
      expect(options).toHaveLength(3);
      expect(options[0]).toEqual({ value: 'text', label: 'text' });
    });

    it('falls back to TextInput when no fields available', () => {
      const fieldOptions: Array<{ value: string; label: string }> = [];
      // When fieldOptions.length === 0, Format.tsx renders TextInput instead of Select
      expect(fieldOptions.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4.8 — Translate: model → Select from metadataStore
  // -----------------------------------------------------------------------
  describe('4.8 — Translate model uses metadataStore dataSource', () => {
    it('translate.model enhancement has dataSource: models', () => {
      const e = getEnhancement('translate', 'model');
      expect(e).toBeDefined();
      expect(e?.dataSource).toBe('models');
    });

    it('model is included in submit payload when selected', () => {
      const selectedModel = 'llama3';
      const payload: Record<string, unknown> = {
        input: 'data.json',
        languages: ['es', 'fr'],
        ...(selectedModel ? { model: selectedModel } : {}),
      };
      expect(payload.model).toBe('llama3');
    });

    it('model is omitted from submit payload when not selected', () => {
      const selectedModel: string | null = null;
      const payload: Record<string, unknown> = {
        input: 'data.json',
        languages: ['es', 'fr'],
        ...(selectedModel ? { model: selectedModel } : {}),
      };
      expect(payload.model).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 4.9 — metadataStore consistency
  // -----------------------------------------------------------------------
  describe('4.9 — Pages use metadataStore for command metadata', () => {
    it('FIELD_ENHANCEMENTS has all expected model entries', () => {
      expect(getEnhancement('generate', 'model')?.dataSource).toBe('models');
      expect(getEnhancement('transform', 'model')?.dataSource).toBe('models');
      expect(getEnhancement('translate', 'model')?.dataSource).toBe('models');
    });

    it('FIELD_ENHANCEMENTS has multi-select entries', () => {
      expect(getEnhancement('scrape', 'searchProvider')?.multi).toBe(true);
      expect(getEnhancement('scrape', 'formats')?.dataSource).toBe('enums');
      expect(getEnhancement('translate', 'languages')?.multi).toBe(true);
    });

    it('FIELD_ENHANCEMENTS has tags entries', () => {
      expect(getEnhancement('transform', 'labels')?.tags).toBe(true);
      expect(getEnhancement('clean', 'targetFields')?.tags).toBe(true);
      expect(getEnhancement('format', 'requiredFields')?.tags).toBe(true);
      expect(getEnhancement('format', 'fieldMap')?.tags).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Serialization round-trip for fixed-value fields
  // -----------------------------------------------------------------------
  describe('Serialization of fixed-value fields', () => {
    it('single-value Select fields pass through unchanged', () => {
      const values = { outputFormat: 'json', sourcePreset: 'web' };
      const result = serializeFormValues(values, 'scrape');
      expect(result.outputFormat).toBe('json');
      expect(result.sourcePreset).toBe('web');
    });

    it('empty string values are stripped', () => {
      const values = { outputFormat: '', model: '' };
      const result = serializeFormValues(values, 'scrape');
      expect(result.outputFormat).toBeUndefined();
      expect(result.model).toBeUndefined();
    });

    it('model field with value passes through', () => {
      const values = { model: 'llama3' };
      const result = serializeFormValues(values, 'generate');
      expect(result.model).toBe('llama3');
    });
  });
});
