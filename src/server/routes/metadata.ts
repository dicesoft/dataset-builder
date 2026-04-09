/**
 * T022: Metadata routes
 * GET /formats — list available ML output formats
 * GET /templates — list available transform templates
 * GET /languages — list supported translation languages
 * GET /models — list available Ollama models (proxy to Ollama API)
 */

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { listFormatters, getFormattersByCategory } from '../../formatters/registry';
import {
  listTemplates,
  templateRequiresLlm,
  templateUsesVision,
  getTemplateInputTypes,
} from '../../transformer/templates';
import { COMMON_LANGUAGES, listSupportedLanguages } from '../../translator/languages';
import { getConfig } from '../../config';
import { ensureProviders, listProviders } from '../../scrapy/search/registry';
import { ok, fail } from '../utils/envelope';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const metadataRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, never>,
  done
) => {
  // -----------------------------------------------------------------------
  // GET /formats — list available ML output formats
  // -----------------------------------------------------------------------
  fastify.get('/formats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Ensure formatters are registered by importing the index module
      // (the formatters index.ts registers all formatters as a side effect)
      await import('../../formatters/index');

      const all = listFormatters();
      const byCategory = getFormattersByCategory();

      return ok(
        'metadata.formats',
        {
          formats: all,
          byCategory,
          count: all.length,
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('metadata.formats', 'FORMATS_LOAD_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /templates — list available transform templates
  // -----------------------------------------------------------------------
  fastify.get('/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const templateList = listTemplates();

      const templates = templateList.map((t) => ({
        name: t.name,
        description: t.description,
        requiresLlm: templateRequiresLlm(t.name),
        usesVision: templateUsesVision(t.name),
        supportedInputs: getTemplateInputTypes(t.name),
      }));

      return ok(
        'metadata.templates',
        {
          templates,
          count: templates.length,
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('metadata.templates', 'TEMPLATES_LOAD_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /languages — list supported translation languages
  // -----------------------------------------------------------------------
  fastify.get(
    '/languages',
    async (request: FastifyRequest<{ Querystring: { model?: string } }>, reply: FastifyReply) => {
      try {
        const { model } = request.query;
        const languages = listSupportedLanguages(model);

        return ok(
          'metadata.languages',
          {
            languages,
            count: languages.length,
            ...(model ? { filteredByModel: model } : {}),
          },
          reply
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('metadata.languages', 'LANGUAGES_LOAD_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /models — list available Ollama models (proxy to Ollama API)
  // -----------------------------------------------------------------------
  fastify.get('/models', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = getConfig();
      const ollamaUrl = config.get('ollamaUrl');

      // Proxy to Ollama's /api/tags endpoint to list available models
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      let response: Response;
      try {
        response = await fetch(`${ollamaUrl}/api/tags`, {
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timeout);
        return ok(
          'metadata.models',
          {
            models: [],
            available: false,
            error: 'Ollama server is not reachable',
            ollamaUrl,
          },
          reply
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        return ok(
          'metadata.models',
          {
            models: [],
            available: false,
            error: `Ollama returned status ${response.status}`,
            ollamaUrl,
          },
          reply
        );
      }

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          size: number;
          modified_at: string;
          details?: Record<string, unknown>;
        }>;
      };
      const models = (data.models ?? []).map((m) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        details: m.details ?? null,
      }));

      return ok(
        'metadata.models',
        {
          models,
          available: true,
          count: models.length,
          ollamaUrl,
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('metadata.models', 'MODELS_LOAD_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /providers — list search providers with availability info
  // -----------------------------------------------------------------------
  fastify.get('/providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureProviders();
      const allProviders = listProviders();

      const providers = allProviders.map((p) => ({
        name: p.config.id,
        available: p.isAvailable(),
        requiresKey: p.config.apiKeyConfigName ?? null,
      }));

      return ok('metadata.providers', { providers }, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('metadata.providers', 'PROVIDERS_LOAD_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /metadata/enums — aggregated enum values for all constrained fields
  // -----------------------------------------------------------------------
  fastify.get('/metadata/enums', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return ok(
        'metadata.enums',
        {
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
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('metadata.enums', 'ENUMS_LOAD_FAILED', message, reply, 500);
    }
  });

  done();
};

export default metadataRoutes;
