/**
 * T020: Config API routes
 * GET /config — return all settings
 * PATCH /config — update one or more settings
 * POST /config/reset — reset to defaults (optional key query param)
 */

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import * as path from 'path';
import { ConfigLoader, getConfig, AppConfigKey, defaultConfig } from '../../config';
import { ok, fail } from '../utils/envelope';

// ---------------------------------------------------------------------------
// Sensitive keys that should be masked in GET responses
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set<string>([
  'googleApiKey',
  'bingApiKey',
  'braveApiKey',
  'ollamaApiKey',
  'githubToken',
  'semanticScholarApiKey',
  'serpApiKey',
]);

/**
 * Mask sensitive values so they can be safely returned to the frontend.
 * Shows last 4 characters if the value is long enough, otherwise replaces entirely.
 */
function maskSensitive(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  for (const key of SENSITIVE_KEYS) {
    const val = masked[key];
    if (typeof val === 'string' && val.length > 0) {
      masked[key] = val.length > 8 ? `***${val.slice(-4)}` : '***';
    }
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface ConfigRouteOptions {
  /** Optional ConfigLoader override (for testing). Falls back to singleton. */
  configLoader?: ConfigLoader;
}

const configRoutes: FastifyPluginCallback<ConfigRouteOptions> = (
  fastify: FastifyInstance,
  opts: ConfigRouteOptions,
  done
) => {
  const config = opts.configLoader ?? getConfig();
  const validKeys = new Set(Object.keys(defaultConfig));

  // -----------------------------------------------------------------------
  // GET /config — return all settings (sensitive values masked)
  // -----------------------------------------------------------------------
  fastify.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const all = config.getAll();
      const outputDir = config.get('outputDir' as AppConfigKey);
      return ok(
        'config.get',
        {
          settings: maskSensitive(all as unknown as Record<string, unknown>),
          path: config.getPath(),
          resolvedOutputDir: path.resolve(String(outputDir ?? '')),
          cwd: process.cwd(),
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('config.get', 'CONFIG_READ_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // PATCH /config — update one or more settings
  // -----------------------------------------------------------------------
  fastify.patch('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail(
        'config.update',
        'INVALID_INPUT',
        'Request body must be a plain object',
        reply,
        400
      );
    }

    // Validate keys
    const unknownKeys: string[] = [];
    for (const key of Object.keys(body)) {
      if (!validKeys.has(key)) {
        unknownKeys.push(key);
      }
    }

    if (unknownKeys.length > 0) {
      return fail(
        'config.update',
        'UNKNOWN_KEYS',
        `Unknown config keys: ${unknownKeys.join(', ')}`,
        reply,
        400,
        { unknownKeys, validKeys: [...validKeys].sort() }
      );
    }

    if (Object.keys(body).length === 0) {
      return fail(
        'config.update',
        'INVALID_INPUT',
        'At least one setting must be provided',
        reply,
        400
      );
    }

    try {
      config.setMany(body);
      const updated = config.getAll();
      return ok(
        'config.update',
        {
          settings: maskSensitive(updated as unknown as Record<string, unknown>),
          updatedKeys: Object.keys(body),
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('config.update', 'CONFIG_WRITE_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // POST /config/reset — reset to defaults
  // Optional query param: key — reset only that key
  // -----------------------------------------------------------------------
  fastify.post(
    '/config/reset',
    async (request: FastifyRequest<{ Querystring: { key?: string } }>, reply: FastifyReply) => {
      const { key } = request.query;

      if (key && !validKeys.has(key)) {
        return fail('config.reset', 'UNKNOWN_KEY', `Unknown config key: "${key}"`, reply, 400, {
          validKeys: [...validKeys].sort(),
        });
      }

      try {
        if (key) {
          config.reset(key as AppConfigKey);
        } else {
          config.reset();
        }

        const current = config.getAll();
        return ok(
          'config.reset',
          {
            settings: maskSensitive(current as unknown as Record<string, unknown>),
            resetKey: key ?? null,
          },
          reply
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('config.reset', 'CONFIG_RESET_FAILED', message, reply, 500);
      }
    }
  );

  done();
};

export default configRoutes;
