import { describe, it, expect, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from './index';

/**
 * Integration test for server route registration.
 * Verifies ALL expected API endpoints respond (not 404).
 * Prevents the "routes not registered" bug from recurring.
 */

// Mock static plugin to avoid setNotFoundHandler conflict with error handler
vi.mock('./middleware/static', async () => {
  const { default: fp } = await import('fastify-plugin');
  return {
    default: fp(async () => {}, { name: 'static-files', dependencies: ['error-handler'] }),
  };
});

// Mock dependencies that would require external services
vi.mock('./jobs/manager', () => {
  const mockManager = {
    createJob: vi.fn(),
    getJob: vi.fn(),
    listJobs: vi.fn().mockResolvedValue([]),
    cancelJob: vi.fn(),
    resumeJob: vi.fn(),
    deleteJob: vi.fn(),
    recoverInterruptedJobs: vi.fn().mockResolvedValue(0),
    shutdown: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return {
    getJobManager: () => mockManager,
    JobManager: vi.fn(() => mockManager),
  };
});

vi.mock('./health/checker', () => {
  class MockHealthChecker {
    getReport = vi.fn().mockResolvedValue({
      healthy: true,
      dependencies: [],
      checkedAt: new Date().toISOString(),
    });
    refresh = vi.fn().mockResolvedValue({
      healthy: true,
      dependencies: [],
      checkedAt: new Date().toISOString(),
    });
  }
  return { HealthChecker: MockHealthChecker };
});

let app: FastifyInstance;

afterEach(async () => {
  if (app) {
    await app.close();
  }
});

describe('Server route registration', () => {
  it('boots the server successfully', async () => {
    app = await buildServer();
    expect(app).toBeDefined();
  });

  it('GET /api/v1/health responds (not 404)', async () => {
    app = await buildServer();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).not.toBe(404);
    expect(res.json().command).toBe('health');
  });

  it('GET /api/v1/jobs responds (not 404)', async () => {
    app = await buildServer();

    const res = await app.inject({ method: 'GET', url: '/api/v1/jobs' });
    expect(res.statusCode).not.toBe(404);
    expect(res.json().command).toBe('jobs.list');
  });

  it('GET /api/v1/config responds (not 404)', async () => {
    app = await buildServer();

    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).not.toBe(404);
    expect(res.json().command).toBe('config.get');
  });

  it('GET /api/v1/commands responds (not 404)', async () => {
    app = await buildServer();

    const res = await app.inject({ method: 'GET', url: '/api/v1/commands' });
    expect(res.statusCode).not.toBe(404);
    expect(res.json().command).toBe('commands.list');
  });

  it('GET /api/v1/datasets responds (not 404)', async () => {
    app = await buildServer();

    const res = await app.inject({ method: 'GET', url: '/api/v1/datasets' });
    expect(res.statusCode).not.toBe(404);
    expect(res.json().command).toBe('datasets.list');
  });

  it('POST /api/v1/upload endpoint exists (not 404)', async () => {
    app = await buildServer();

    // Send an empty multipart to verify route exists (will get 400, not 404)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/upload',
      headers: { 'content-type': 'multipart/form-data; boundary=----test' },
      payload: '------test--\r\n',
    });

    // Should NOT be 404 — any other status (400, 500) means the route IS registered
    expect(res.statusCode).not.toBe(404);
  });

  it('GET /api/v1/ping responds', async () => {
    app = await buildServer();

    const res = await app.inject({ method: 'GET', url: '/api/v1/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.pong).toBe(true);
  });

  it('all critical routes are registered in a single server instance', async () => {
    app = await buildServer();

    const routes = [
      { method: 'GET' as const, url: '/api/v1/health' },
      { method: 'GET' as const, url: '/api/v1/jobs' },
      { method: 'GET' as const, url: '/api/v1/config' },
      { method: 'GET' as const, url: '/api/v1/commands' },
      { method: 'GET' as const, url: '/api/v1/datasets' },
    ];

    for (const route of routes) {
      const res = await app.inject(route);
      expect(res.statusCode, `${route.method} ${route.url} returned 404`).not.toBe(404);
    }
  });
});
