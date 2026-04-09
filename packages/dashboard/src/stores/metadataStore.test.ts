import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMetadataStore } from './metadataStore';

vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from '../utils/api';
const mockApiGet = vi.mocked(apiGet);

function makeFormatsResponse() {
  return {
    formats: [{ name: 'alpaca', description: 'Alpaca format' }],
    byCategory: { 'Text/LLM': [{ name: 'alpaca', description: 'Alpaca format' }] },
    count: 1,
  };
}

function makeTemplatesResponse() {
  return {
    templates: [
      {
        name: 'qa',
        description: 'Q&A template',
        requiresLlm: true,
        usesVision: false,
        supportedInputs: ['json', 'jsonl'],
      },
    ],
    count: 1,
  };
}

function makeLanguagesResponse() {
  return {
    languages: [{ code: 'es', name: 'Spanish', nativeName: 'Español' }],
    count: 1,
  };
}

function makeModelsResponse() {
  return {
    models: [{ name: 'llama3', size: 4000000000, modifiedAt: '2026-01-01', details: null }],
    available: true,
    count: 1,
  };
}

function makeCommandsResponse() {
  return {
    commands: [
      {
        name: 'scrape',
        description: 'Scrape data',
        options: [
          {
            name: 'outputFormat',
            flags: '--output-format <format>',
            description: 'Output format',
            required: false,
            type: 'string' as const,
            defaultValue: null,
            choices: ['json', 'jsonl', 'csv', 'xml'],
          },
        ],
        dependencies: ['python', 'scrapy'],
      },
    ],
  };
}

function makeProvidersResponse() {
  return {
    providers: [
      { name: 'google', available: true, requiresKey: 'googleApiKey' },
      { name: 'duckduckgo', available: true, requiresKey: null },
      { name: 'brave', available: false, requiresKey: 'braveApiKey' },
    ],
  };
}

function makeEnumsResponse() {
  return {
    outputFormats: ['json', 'jsonl', 'csv', 'xml'],
    downloadFormats: [
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
    ],
    generateTypes: ['person', 'address', 'company', 'product', 'text', 'lorem', 'llm', 'all'],
    strictnessLevels: ['low', 'medium', 'high'],
    videoCodecs: ['h264', 'h265', 'av1'],
    videoFormats: ['mp4', 'webm', 'mkv'],
    validateMethods: ['deterministic', 'llm'],
    sourcePresets: ['web', 'images', 'videos', 'academic', 'code', '3d-assets', 'social'],
  };
}

function mockAllEndpoints() {
  mockApiGet.mockImplementation((url: string) => {
    if (url.includes('/metadata/enums')) return Promise.resolve(makeEnumsResponse());
    if (url.includes('/formats')) return Promise.resolve(makeFormatsResponse());
    if (url.includes('/templates')) return Promise.resolve(makeTemplatesResponse());
    if (url.includes('/languages')) return Promise.resolve(makeLanguagesResponse());
    if (url.includes('/models')) return Promise.resolve(makeModelsResponse());
    if (url.includes('/commands')) return Promise.resolve(makeCommandsResponse());
    if (url.includes('/providers')) return Promise.resolve(makeProvidersResponse());
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

describe('metadataStore', () => {
  beforeEach(() => {
    useMetadataStore.setState({
      formats: [],
      formatsByCategory: {},
      templates: [],
      languages: [],
      models: [],
      modelsAvailable: false,
      commandMetas: new Map(),
      providers: [],
      enums: null,
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('fetchAll', () => {
    it('populates all state fields from parallel API requests', async () => {
      mockAllEndpoints();

      await useMetadataStore.getState().fetchAll();

      const state = useMetadataStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.formats).toHaveLength(1);
      expect(state.formats[0].name).toBe('alpaca');
      expect(state.formatsByCategory['Text/LLM']).toHaveLength(1);
      expect(state.templates).toHaveLength(1);
      expect(state.templates[0].name).toBe('qa');
      expect(state.languages).toHaveLength(1);
      expect(state.languages[0].code).toBe('es');
      expect(state.models).toHaveLength(1);
      expect(state.models[0].name).toBe('llama3');
      expect(state.modelsAvailable).toBe(true);
      expect(state.commandMetas.size).toBe(1);
      expect(state.commandMetas.get('scrape')?.options[0].choices).toEqual([
        'json',
        'jsonl',
        'csv',
        'xml',
      ]);
      expect(state.providers).toHaveLength(3);
      expect(state.providers[0].name).toBe('google');
      expect(state.providers[2].available).toBe(false);
      expect(state.enums).not.toBeNull();
      expect(state.enums!.outputFormats).toEqual(['json', 'jsonl', 'csv', 'xml']);
      expect(state.enums!.sourcePresets).toContain('web');
    });

    it('sets loading to true during fetch', async () => {
      let resolvePromise: () => void;
      const blockingPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      mockApiGet.mockImplementation(() => blockingPromise.then(() => makeFormatsResponse()));

      const fetchPromise = useMetadataStore.getState().fetchAll();
      expect(useMetadataStore.getState().loading).toBe(true);

      resolvePromise!();
      await fetchPromise;
      expect(useMetadataStore.getState().loading).toBe(false);
    });

    it('sets error when an endpoint fails', async () => {
      mockApiGet.mockRejectedValue(new Error('Network error'));

      await useMetadataStore.getState().fetchAll();

      const state = useMetadataStore.getState();
      expect(state.loading).toBe(false);
      expect(state.error).toBe('Network error');
    });

    it('replaces stale data on re-fetch', async () => {
      // First fetch
      mockAllEndpoints();
      await useMetadataStore.getState().fetchAll();
      expect(useMetadataStore.getState().formats).toHaveLength(1);

      // Second fetch with updated data
      mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/metadata/enums')) return Promise.resolve(makeEnumsResponse());
        if (url.includes('/formats'))
          return Promise.resolve({
            formats: [
              { name: 'alpaca', description: 'Alpaca format' },
              { name: 'chatml', description: 'ChatML format' },
            ],
            byCategory: {},
            count: 2,
          });
        if (url.includes('/templates')) return Promise.resolve(makeTemplatesResponse());
        if (url.includes('/languages')) return Promise.resolve(makeLanguagesResponse());
        if (url.includes('/models')) return Promise.resolve(makeModelsResponse());
        if (url.includes('/commands')) return Promise.resolve(makeCommandsResponse());
        if (url.includes('/providers')) return Promise.resolve(makeProvidersResponse());
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      await useMetadataStore.getState().fetchAll();
      expect(useMetadataStore.getState().formats).toHaveLength(2);
    });

    it('fires all 7 API requests in parallel', async () => {
      mockAllEndpoints();

      await useMetadataStore.getState().fetchAll();

      expect(mockApiGet).toHaveBeenCalledTimes(7);
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/formats');
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/templates');
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/languages');
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/models');
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/commands');
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/providers');
      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/metadata/enums');
    });
  });
});
