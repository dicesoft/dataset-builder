import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import metadataRoutes from './metadata';

/**
 * T090: Contract tests for Metadata API routes
 * Tests: GET /formats, GET /templates, GET /languages, GET /models
 */

// ---------------------------------------------------------------------------
// Mock all imported modules
// ---------------------------------------------------------------------------

vi.mock('../../formatters/registry', () => ({
  listFormatters: vi.fn(() => [
    { name: 'alpaca', description: 'Alpaca format', category: 'text' },
    { name: 'sharegpt', description: 'ShareGPT format', category: 'text' },
    { name: 'coco', description: 'COCO format', category: 'vision' },
  ]),
  getFormattersByCategory: vi.fn(() => ({
    text: ['alpaca', 'sharegpt'],
    vision: ['coco'],
  })),
}));

vi.mock('../../formatters/index', () => ({}));

vi.mock('../../transformer/templates', () => ({
  listTemplates: vi.fn(() => [
    { name: 'text-qa', description: 'Q&A pairs' },
    { name: 'image-classification', description: 'Classify images' },
  ]),
  templateRequiresLlm: vi.fn((name: string) => name === 'text-qa'),
  templateUsesVision: vi.fn((name: string) => name === 'image-classification'),
  getTemplateInputTypes: vi.fn(() => ['json', 'jsonl']),
}));

vi.mock('../../translator/languages', () => ({
  COMMON_LANGUAGES: ['en', 'es', 'fr'],
  listSupportedLanguages: vi.fn(() => [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
  ]),
}));

vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => {
      if (key === 'ollamaUrl') return 'http://localhost:11434';
      if (key === 'googleApiKey') return 'test-key';
      if (key === 'braveApiKey') return '';
      return '';
    },
  }),
}));

vi.mock('../../scrapy/search/registry', () => ({
  ensureProviders: vi.fn(async () => {}),
  listProviders: vi.fn(() => [
    {
      config: {
        id: 'google',
        name: 'Google',
        requiresApiKey: true,
        apiKeyConfigName: 'googleApiKey',
      },
      isAvailable: () => true,
    },
    {
      config: { id: 'duckduckgo', name: 'DuckDuckGo', requiresApiKey: false },
      isAvailable: () => true,
    },
    {
      config: { id: 'brave', name: 'Brave', requiresApiKey: true, apiKeyConfigName: 'braveApiKey' },
      isAvailable: () => false,
    },
  ]),
}));

// Mock global fetch for Ollama models endpoint
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Metadata API routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(metadataRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // GET /formats
  // -----------------------------------------------------------------------

  describe('GET /formats', () => {
    it('returns formats with envelope format', async () => {
      const res = await app.inject({ method: 'GET', url: '/formats' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.success).toBe(true);
      expect(body.command).toBe('metadata.formats');
      expect(body.data).toHaveProperty('formats');
      expect(body.data).toHaveProperty('byCategory');
      expect(body.data).toHaveProperty('count');
    });

    it('returns format list', async () => {
      const res = await app.inject({ method: 'GET', url: '/formats' });
      const body = res.json();

      expect(body.data.formats).toHaveLength(3);
      expect(body.data.count).toBe(3);
    });

    it('returns formats grouped by category', async () => {
      const res = await app.inject({ method: 'GET', url: '/formats' });
      const body = res.json();

      expect(body.data.byCategory).toHaveProperty('text');
      expect(body.data.byCategory).toHaveProperty('vision');
    });
  });

  // -----------------------------------------------------------------------
  // GET /templates
  // -----------------------------------------------------------------------

  describe('GET /templates', () => {
    it('returns templates with metadata', async () => {
      const res = await app.inject({ method: 'GET', url: '/templates' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('metadata.templates');
      expect(body.data.templates).toHaveLength(2);
      expect(body.data.count).toBe(2);
    });

    it('includes requiresLlm and usesVision flags', async () => {
      const res = await app.inject({ method: 'GET', url: '/templates' });
      const templates = res.json().data.templates;

      const textQa = templates.find((t: any) => t.name === 'text-qa');
      expect(textQa.requiresLlm).toBe(true);
      expect(textQa.usesVision).toBe(false);

      const imgClass = templates.find((t: any) => t.name === 'image-classification');
      expect(imgClass.requiresLlm).toBe(false);
      expect(imgClass.usesVision).toBe(true);
    });

    it('includes supportedInputs', async () => {
      const res = await app.inject({ method: 'GET', url: '/templates' });
      const templates = res.json().data.templates;

      expect(templates[0].supportedInputs).toEqual(['json', 'jsonl']);
    });
  });

  // -----------------------------------------------------------------------
  // GET /languages
  // -----------------------------------------------------------------------

  describe('GET /languages', () => {
    it('returns supported languages', async () => {
      const res = await app.inject({ method: 'GET', url: '/languages' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('metadata.languages');
      expect(body.data.languages).toHaveLength(3);
      expect(body.data.count).toBe(3);
    });

    it('passes model query param to listSupportedLanguages', async () => {
      const { listSupportedLanguages } = await import('../../translator/languages');

      await app.inject({ method: 'GET', url: '/languages?model=llama3.2' });

      expect(listSupportedLanguages).toHaveBeenCalledWith('llama3.2');
    });
  });

  // -----------------------------------------------------------------------
  // GET /models
  // -----------------------------------------------------------------------

  describe('GET /models', () => {
    it('returns models from Ollama when available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.2', size: 4000000000, modified_at: '2026-01-01', details: {} },
            { name: 'gemma2', size: 2000000000, modified_at: '2026-02-01' },
          ],
        }),
      });

      const res = await app.inject({ method: 'GET', url: '/models' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('metadata.models');
      expect(body.data.models).toHaveLength(2);
      expect(body.data.available).toBe(true);
      expect(body.data.count).toBe(2);
    });

    it('returns empty models when Ollama is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await app.inject({ method: 'GET', url: '/models' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.models).toEqual([]);
      expect(body.data.available).toBe(false);
      expect(body.data.error).toBeTruthy();
    });

    it('returns empty models when Ollama returns non-200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await app.inject({ method: 'GET', url: '/models' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.models).toEqual([]);
      expect(body.data.available).toBe(false);
    });

    it('includes ollamaUrl in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const res = await app.inject({ method: 'GET', url: '/models' });
      expect(res.json().data.ollamaUrl).toBe('http://localhost:11434');
    });
  });

  // -----------------------------------------------------------------------
  // GET /providers
  // -----------------------------------------------------------------------

  describe('GET /providers', () => {
    it('returns providers with correct shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/providers' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('metadata.providers');
      expect(body.data.providers).toHaveLength(3);
    });

    it('includes availability and requiresKey for each provider', async () => {
      const res = await app.inject({ method: 'GET', url: '/providers' });
      const providers = res.json().data.providers;

      const google = providers.find((p: any) => p.name === 'google');
      expect(google.available).toBe(true);
      expect(google.requiresKey).toBe('googleApiKey');

      const ddg = providers.find((p: any) => p.name === 'duckduckgo');
      expect(ddg.available).toBe(true);
      expect(ddg.requiresKey).toBeNull();

      const brave = providers.find((p: any) => p.name === 'brave');
      expect(brave.available).toBe(false);
      expect(brave.requiresKey).toBe('braveApiKey');
    });
  });

  // -----------------------------------------------------------------------
  // GET /metadata/enums
  // -----------------------------------------------------------------------

  describe('GET /metadata/enums', () => {
    it('returns all expected enum groups', async () => {
      const res = await app.inject({ method: 'GET', url: '/metadata/enums' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('metadata.enums');

      const data = body.data;
      expect(data.outputFormats).toEqual(['json', 'jsonl', 'csv', 'xml']);
      expect(data.downloadFormats).toHaveLength(10);
      expect(data.downloadFormats).toContain('audio');
      expect(data.downloadFormats).toContain('archive');
      expect(data.downloadFormats).toContain('spreadsheet');
      expect(data.downloadFormats).toContain('document');
      expect(data.generateTypes).toHaveLength(8);
      expect(data.strictnessLevels).toEqual(['low', 'medium', 'high']);
      expect(data.videoCodecs).toEqual(['h264', 'h265', 'av1']);
      expect(data.videoFormats).toEqual(['mp4', 'webm', 'mkv']);
      expect(data.validateMethods).toEqual(['deterministic', 'llm']);
      expect(data.sourcePresets).toHaveLength(7);
      expect(data.sourcePresets).toContain('3d-assets');
    });
  });
});
