import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import configRoutes from './config';

/**
 * T090: Contract tests for Config API routes
 */

// ---------------------------------------------------------------------------
// Mock config module so we don't touch the real config
// ---------------------------------------------------------------------------

vi.mock('../../config', () => {
  const store: Record<string, unknown> = {
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
    outputDir: './output',
    googleApiKey: 'super-secret-key-12345678',
  };

  const defaults: Record<string, unknown> = {
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
    outputDir: './output',
    googleApiKey: '',
  };

  const configLoader = {
    get: (key: string) => store[key],
    getAll: () => ({ ...store }),
    getPath: () => '/home/user/.config/dataset-builder/config.json',
    setMany: (updates: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(updates)) {
        store[k] = v;
      }
    },
    reset: (key?: string) => {
      if (key) {
        store[key] = defaults[key];
      } else {
        for (const [k, v] of Object.entries(defaults)) {
          store[k] = v;
        }
      }
    },
  };

  return {
    getConfig: () => configLoader,
    ConfigLoader: vi.fn(() => configLoader),
    defaultConfig: defaults,
    AppConfigKey: {},
  };
});

describe('Config API routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(configRoutes, {});
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // GET /config
  // -----------------------------------------------------------------------

  describe('GET /config', () => {
    it('returns config settings with envelope format', async () => {
      const res = await app.inject({ method: 'GET', url: '/config' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.success).toBe(true);
      expect(body.command).toBe('config.get');
      expect(body.data).toHaveProperty('settings');
      expect(body.data).toHaveProperty('path');
    });

    it('masks sensitive config values', async () => {
      const res = await app.inject({ method: 'GET', url: '/config' });
      const body = res.json();

      // googleApiKey should be masked
      const apiKey = body.data.settings.googleApiKey;
      expect(apiKey).toContain('***');
      expect(apiKey).not.toBe('super-secret-key-12345678');
    });

    it('returns non-sensitive values unmasked', async () => {
      const res = await app.inject({ method: 'GET', url: '/config' });
      const body = res.json();

      expect(body.data.settings.ollamaUrl).toBe('http://localhost:11434');
    });

    it('includes resolvedOutputDir as an absolute path', async () => {
      const res = await app.inject({ method: 'GET', url: '/config' });
      const body = res.json();

      expect(body.data).toHaveProperty('resolvedOutputDir');
      // Should be an absolute path (platform-aware check)
      const resolved = body.data.resolvedOutputDir;
      expect(typeof resolved).toBe('string');
      expect(resolved.length).toBeGreaterThan(0);
      // path.resolve('./output') should produce an absolute path
      expect(require('path').isAbsolute(resolved)).toBe(true);
    });

    it('includes cwd as an absolute path', async () => {
      const res = await app.inject({ method: 'GET', url: '/config' });
      const body = res.json();

      expect(body.data).toHaveProperty('cwd');
      expect(body.data.cwd).toBe(process.cwd());
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /config
  // -----------------------------------------------------------------------

  describe('PATCH /config', () => {
    it('updates config and returns updated settings', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/config',
        payload: { ollamaModel: 'gemma2' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('config.update');
      expect(body.data).toHaveProperty('settings');
      expect(body.data).toHaveProperty('updatedKeys');
      expect(body.data.updatedKeys).toContain('ollamaModel');
    });

    it('returns 400 for empty body', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/config',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 for non-object body', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/config',
        payload: 'not an object',
        headers: { 'content-type': 'application/json' },
      });

      // Fastify will likely reject malformed JSON or we handle it
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('returns 400 for unknown config keys', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/config',
        payload: { unknownKey: 'value' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('UNKNOWN_KEYS');
    });
  });

  // -----------------------------------------------------------------------
  // POST /config/reset
  // -----------------------------------------------------------------------

  describe('POST /config/reset', () => {
    it('resets all config to defaults', async () => {
      const res = await app.inject({ method: 'POST', url: '/config/reset' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('config.reset');
      expect(body.data).toHaveProperty('settings');
      expect(body.data.resetKey).toBeNull();
    });

    it('resets a specific key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/config/reset?key=ollamaModel',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.resetKey).toBe('ollamaModel');
    });

    it('returns 400 for unknown key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/config/reset?key=totallyFakeKey',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('UNKNOWN_KEY');
    });
  });
});
