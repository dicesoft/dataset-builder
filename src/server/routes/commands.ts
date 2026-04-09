/**
 * T021: Command Metadata routes
 * GET /commands — introspect Commander.js program to extract command metadata
 * GET /commands/:name/presets — return presets for a specific command
 * GET /commands/:name/templates — return templates for a specific command
 */

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { Command, Option } from 'commander';
import { program } from '../../cli/program';
import { ok, fail } from '../utils/envelope';

// ---------------------------------------------------------------------------
// Commander.js introspection helpers
// ---------------------------------------------------------------------------

interface CommandOptionMeta {
  name: string;
  flags: string;
  description: string;
  required: boolean;
  type: 'string' | 'boolean' | 'number' | 'unknown';
  defaultValue: unknown;
  choices: string[] | null;
}

interface CommandMeta {
  name: string;
  description: string;
  options: CommandOptionMeta[];
  /** Which external dependencies this command requires */
  dependencies: string[];
}

/**
 * Map of commands to their known external dependency requirements.
 * These are determined by what each command actually calls at runtime.
 */
const COMMAND_DEPENDENCIES: Record<string, string[]> = {
  scrape: ['python', 'scrapy'],
  generate: ['ollama'],
  transform: ['ollama'],
  translate: ['ollama'],
  compress: ['ffmpeg'],
  'web-search': [],
  import: [],
  export: [],
  clean: [],
  run: [],
  config: [],
  prune: [],
  resume: [],
  format: [],
};

/**
 * Infer the option type from Commander.js Option metadata
 */
function inferOptionType(option: Option): 'string' | 'boolean' | 'number' | 'unknown' {
  // Boolean flags have no argument expectation
  if (option.isBoolean()) return 'boolean';
  if ((option as any).negate) return 'boolean';

  // Check if the flag description or name hints at a number
  const flags = option.flags;
  const desc = option.description.toLowerCase();
  if (
    desc.includes('number') ||
    desc.includes('count') ||
    desc.includes('limit') ||
    desc.includes('concurrent') ||
    desc.includes('batch') ||
    desc.includes('size') ||
    desc.includes('seed') ||
    flags.includes('<number>') ||
    flags.includes('<n>')
  ) {
    return 'number';
  }

  // If it expects an argument, it's a string
  if (option.required || option.optional) return 'string';

  return 'unknown';
}

// CLI-only introspection flags that should not appear in the web UI
const CLI_ONLY_FIELDS = new Set([
  'listPresets',
  'listProviders',
  'listTemplates',
  'listFormats',
  'listLanguages',
  'listModels',
  'helpFormat',
]);

/**
 * Extract metadata from a single Commander.js Command
 */
function extractCommandMeta(cmd: Command): CommandMeta {
  const name = cmd.name();
  const description = cmd.description() || '';

  const options: CommandOptionMeta[] = cmd.options
    .filter((opt: Option) => !CLI_ONLY_FIELDS.has(opt.attributeName()))
    .map((opt: Option) => {
      const attrName = opt.attributeName();

      return {
        name: attrName,
        flags: opt.flags,
        description: opt.description,
        required: (opt as any).mandatory === true,
        type: inferOptionType(opt),
        defaultValue: opt.defaultValue ?? null,
        choices: (opt as any).argChoices ?? null,
      };
    });

  const dependencies = COMMAND_DEPENDENCIES[name] ?? [];

  return { name, description, options, dependencies };
}

// ---------------------------------------------------------------------------
// Presets — static known presets for common commands
// ---------------------------------------------------------------------------

const COMMAND_PRESETS: Record<
  string,
  Array<{ name: string; description: string; options: Record<string, unknown> }>
> = {
  scrape: [
    {
      name: 'quick-scrape',
      description: 'Fast scrape with low limits for testing',
      options: { limit: 5, maxConcurrent: 2, depth: 1 },
    },
    {
      name: 'deep-scrape',
      description: 'Thorough scrape with higher limits',
      options: { limit: 50, maxConcurrent: 5, depth: 3 },
    },
  ],
  generate: [
    {
      name: 'small-batch',
      description: 'Generate a small dataset for testing',
      options: { count: 10 },
    },
    {
      name: 'large-batch',
      description: 'Generate a large production dataset',
      options: { count: 1000 },
    },
  ],
  transform: [
    {
      name: 'text-qa-fast',
      description: 'Quick Q&A transform without LLM',
      options: { template: 'text-qa', noLlm: true },
    },
    {
      name: 'image-classification',
      description: 'Classify images using vision model',
      options: { template: 'image-classification' },
    },
  ],
  format: [
    {
      name: 'alpaca-standard',
      description: 'Standard Alpaca format with 80/10/10 split',
      options: { format: 'alpaca', split: '80:10:10' },
    },
    {
      name: 'sharegpt-chat',
      description: 'ShareGPT conversation format',
      options: { format: 'sharegpt', split: '80:10:10' },
    },
  ],
};

// ---------------------------------------------------------------------------
// Templates — template metadata for commands that support them
// ---------------------------------------------------------------------------

const COMMAND_TEMPLATES: Record<
  string,
  Array<{ name: string; description: string; fields: string[] }>
> = {
  transform: [
    {
      name: 'raw-extract',
      description: 'Extract raw text content',
      fields: ['text', 'source_url'],
    },
    {
      name: 'text-instruct',
      description: 'Generate instruction/output pairs',
      fields: ['instruction', 'output'],
    },
    {
      name: 'text-qa',
      description: 'Generate question/answer pairs',
      fields: ['question', 'answer'],
    },
    {
      name: 'text-conversation',
      description: 'Generate multi-turn conversations',
      fields: ['messages'],
    },
    {
      name: 'image-classification',
      description: 'Classify images by content',
      fields: ['image', 'label'],
    },
    {
      name: 'image-captioning',
      description: 'Generate image captions',
      fields: ['image', 'caption'],
    },
    {
      name: 'vision-qa',
      description: 'Generate visual Q&A pairs',
      fields: ['image', 'question', 'answer'],
    },
    {
      name: 'audio-classification',
      description: 'Classify audio files',
      fields: ['audio', 'label'],
    },
    {
      name: 'object-detection',
      description: 'Detect objects with bounding boxes',
      fields: ['image', 'objects'],
    },
    { name: 'segmentation', description: 'Segment image regions', fields: ['image', 'masks'] },
  ],
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const commandsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, never>,
  done
) => {
  // -----------------------------------------------------------------------
  // GET /commands — list all commands with their options
  // -----------------------------------------------------------------------
  fastify.get('/commands', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const subcommands = (program as any).commands as Command[];
      const commands: CommandMeta[] = subcommands.map(extractCommandMeta);

      return ok(
        'commands.list',
        {
          commands,
          count: commands.length,
        },
        reply
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('commands.list', 'INTROSPECTION_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /commands/:name/presets — return presets for a command
  // -----------------------------------------------------------------------
  fastify.get(
    '/commands/:name/presets',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;

      // Verify command exists
      const subcommands = (program as any).commands as Command[];
      const found = subcommands.find((cmd: Command) => cmd.name() === name);

      if (!found) {
        return fail('commands.presets', 'NOT_FOUND', `Command "${name}" not found`, reply, 404);
      }

      const presets = COMMAND_PRESETS[name] ?? [];
      return ok('commands.presets', { command: name, presets }, reply);
    }
  );

  // -----------------------------------------------------------------------
  // GET /commands/:name/templates — return templates for a command
  // -----------------------------------------------------------------------
  fastify.get(
    '/commands/:name/templates',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;

      // Verify command exists
      const subcommands = (program as any).commands as Command[];
      const found = subcommands.find((cmd: Command) => cmd.name() === name);

      if (!found) {
        return fail('commands.templates', 'NOT_FOUND', `Command "${name}" not found`, reply, 404);
      }

      const templates = COMMAND_TEMPLATES[name] ?? [];
      return ok('commands.templates', { command: name, templates }, reply);
    }
  );

  done();
};

export default commandsRoutes;
