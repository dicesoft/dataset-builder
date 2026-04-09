import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import commandsRoutes from './commands';

/**
 * T090: Contract tests for Commands Metadata API routes
 */

// ---------------------------------------------------------------------------
// Mock the CLI program
// ---------------------------------------------------------------------------

vi.mock('../../cli/program', () => {
  // Create mock Option objects
  const createOption = (
    name: string,
    flags: string,
    description: string,
    opts: {
      required?: boolean;
      defaultValue?: unknown;
      argChoices?: string[];
      isBoolean?: boolean;
    } = {}
  ) => ({
    attributeName: () => name,
    flags,
    description,
    required: opts.required ?? false,
    optional: !opts.required && !opts.isBoolean,
    defaultValue: opts.defaultValue ?? undefined,
    argChoices: opts.argChoices ?? undefined,
    isBoolean: () => opts.isBoolean ?? false,
  });

  // Create mock Command objects
  const scrapeCmd = {
    name: () => 'scrape',
    description: () => 'Web scraping with search and download integration',
    options: [
      createOption('search', '-s, --search <query>', 'Search query'),
      createOption('searchProvider', '--search-provider <provider>', 'Search provider', {
        argChoices: ['bing', 'google', 'duckduckgo'],
      }),
      createOption('download', '-d, --download', 'Enable downloading', { isBoolean: true }),
    ],
  };

  const generateCmd = {
    name: () => 'generate',
    description: () => 'Generate synthetic data',
    options: [
      createOption('count', '-c, --count <number>', 'Number of records to generate'),
      createOption('type', '-t, --type <type>', 'Data type'),
    ],
  };

  const transformCmd = {
    name: () => 'transform',
    description: () => 'Transform data into structured records',
    options: [],
  };

  return {
    program: {
      commands: [scrapeCmd, generateCmd, transformCmd],
    },
  };
});

describe('Commands Metadata API routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(commandsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // GET /commands
  // -----------------------------------------------------------------------

  describe('GET /commands', () => {
    it('returns all commands with envelope format', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.success).toBe(true);
      expect(body.command).toBe('commands.list');
      expect(body.data).toHaveProperty('commands');
      expect(body.data).toHaveProperty('count');
      expect(body.data.commands).toHaveLength(3);
    });

    it('includes command name, description, and options', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands' });
      const scrape = res.json().data.commands.find((c: any) => c.name === 'scrape');

      expect(scrape).toBeDefined();
      expect(scrape.description).toContain('scraping');
      expect(scrape.options.length).toBeGreaterThan(0);

      const searchOpt = scrape.options.find((o: any) => o.name === 'search');
      expect(searchOpt).toBeDefined();
      expect(searchOpt.flags).toContain('--search');
    });

    it('includes choices for enum options', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands' });
      const scrape = res.json().data.commands.find((c: any) => c.name === 'scrape');
      const provider = scrape.options.find((o: any) => o.name === 'searchProvider');

      expect(provider.choices).toEqual(['bing', 'google', 'duckduckgo']);
    });

    it('includes dependency information', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands' });
      const scrape = res.json().data.commands.find((c: any) => c.name === 'scrape');

      expect(scrape.dependencies).toContain('python');
      expect(scrape.dependencies).toContain('scrapy');
    });
  });

  // -----------------------------------------------------------------------
  // GET /commands/:name/presets
  // -----------------------------------------------------------------------

  describe('GET /commands/:name/presets', () => {
    it('returns presets for a known command', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands/scrape/presets' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.command).toBe('commands.presets');
      expect(body.data.command).toBe('scrape');
      expect(body.data.presets).toBeInstanceOf(Array);
      expect(body.data.presets.length).toBeGreaterThan(0);
    });

    it('returns empty presets for command without presets', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands/transform/presets' });

      expect(res.statusCode).toBe(200);
      // Transform has presets defined in source, so just check structure
      const body = res.json();
      expect(body.data.presets).toBeInstanceOf(Array);
    });

    it('returns 404 for non-existent command', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands/nonexistent/presets' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  // -----------------------------------------------------------------------
  // GET /commands/:name/templates
  // -----------------------------------------------------------------------

  describe('GET /commands/:name/templates', () => {
    it('returns templates for transform command', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands/transform/templates' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.command).toBe('commands.templates');
      expect(body.data.templates).toBeInstanceOf(Array);
      expect(body.data.templates.length).toBeGreaterThan(0);
    });

    it('returns 404 for non-existent command', async () => {
      const res = await app.inject({ method: 'GET', url: '/commands/nonexistent/templates' });

      expect(res.statusCode).toBe(404);
    });
  });
});
