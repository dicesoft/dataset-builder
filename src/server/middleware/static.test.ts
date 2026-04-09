import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for static file serving plugin — SPA fallback, API route passthrough.
 *
 * The static plugin depends on error-handler and both call setNotFoundHandler.
 * In production, the static plugin's handler overrides the error handler's.
 * In tests, we provide a no-op error-handler stub to satisfy the dependency.
 */

let fakeRoot: string;
let distDir: string;

beforeAll(() => {
  fakeRoot = path.join(os.tmpdir(), `static-test-${Date.now()}`);
  distDir = path.join(fakeRoot, 'packages', 'dashboard', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>Dashboard</body></html>');
  fs.writeFileSync(path.join(distDir, 'style.css'), 'body {}');
});

afterAll(() => {
  fs.rmSync(fakeRoot, { recursive: true, force: true });
});

// No-op error handler stub that satisfies the dependency name without setting a notFoundHandler
const stubErrorHandler = fp(async () => {}, { name: 'error-handler' });

describe('static plugin with dist directory', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
  });

  async function createApp() {
    vi.spyOn(process, 'cwd').mockReturnValue(fakeRoot);

    const staticPlugin = (await import('./static')).default;

    app = Fastify({ logger: false });
    // Register an API route to test passthrough
    app.get('/api/v1/test', async () => ({ ok: true }));
    // Stub error-handler (satisfies dependency without setNotFoundHandler conflict)
    await app.register(stubErrorHandler);
    await app.register(staticPlugin);
    await app.ready();
    return app;
  }

  it('serves static files from dist directory', async () => {
    await createApp();
    const res = await app.inject({ method: 'GET', url: '/style.css' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('body {}');
  });

  it('falls back to index.html for non-file SPA routes', async () => {
    await createApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Dashboard');
  });

  it('returns 404 JSON for unmatched API routes', async () => {
    await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('passes through registered API routes', async () => {
    await createApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('returns 404 for non-existent files with extensions', async () => {
    await createApp();
    const res = await app.inject({ method: 'GET', url: '/nonexistent.js' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('static plugin without dist directory', () => {
  it('gracefully handles missing dist directory', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent/path');

    const staticPlugin = (await import('./static')).default;

    const app = Fastify({ logger: false });
    await app.register(stubErrorHandler);
    await app.register(staticPlugin);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);

    vi.restoreAllMocks();
    await app.close();
  });
});
