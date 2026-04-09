import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import healthRoutes from './health';

/**
 * T090: Contract tests for Health API routes
 */

function createMockHealthChecker() {
  return {
    getReport: vi.fn().mockResolvedValue({
      healthy: true,
      dependencies: [
        {
          name: 'ollama',
          available: true,
          version: '0.5.14',
          lastCheckedAt: '2026-03-31T00:00:00Z',
          error: null,
          requiredBy: ['generate'],
        },
        {
          name: 'python',
          available: true,
          version: '3.11.5',
          lastCheckedAt: '2026-03-31T00:00:00Z',
          error: null,
          requiredBy: ['scrape'],
        },
        {
          name: 'scrapy',
          available: true,
          version: '2.11.0',
          lastCheckedAt: '2026-03-31T00:00:00Z',
          error: null,
          requiredBy: ['scrape'],
        },
        {
          name: 'ffmpeg',
          available: false,
          version: null,
          lastCheckedAt: '2026-03-31T00:00:00Z',
          error: 'not found',
          requiredBy: ['compress'],
        },
        {
          name: 'yt-dlp',
          available: true,
          version: '2024.12',
          lastCheckedAt: '2026-03-31T00:00:00Z',
          error: null,
          requiredBy: ['scrape'],
        },
      ],
      checkedAt: '2026-03-31T00:00:00Z',
    }),
    refresh: vi.fn().mockResolvedValue({
      healthy: false,
      dependencies: [
        {
          name: 'ollama',
          available: false,
          version: null,
          lastCheckedAt: '2026-03-31T00:01:00Z',
          error: 'Connection refused',
          requiredBy: ['generate'],
        },
      ],
      checkedAt: '2026-03-31T00:01:00Z',
    }),
  };
}

function createMockJobManager() {
  return {
    listJobs: vi
      .fn()
      .mockResolvedValue([
        { status: 'running' },
        { status: 'running' },
        { status: 'queued' },
        { status: 'completed' },
      ]),
  };
}

describe('Health API routes', () => {
  let app: FastifyInstance;
  let mockChecker: ReturnType<typeof createMockHealthChecker>;
  let mockJobManager: ReturnType<typeof createMockJobManager>;

  beforeEach(async () => {
    mockChecker = createMockHealthChecker();
    mockJobManager = createMockJobManager();
    app = Fastify({ logger: false });
    await app.register(healthRoutes, {
      healthChecker: mockChecker as any,
      jobManager: mockJobManager as any,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // GET /health
  // -----------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns health status with correct structure', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.success).toBe(true);
      expect(body.command).toBe('health');
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('uptime');
      expect(body.data).toHaveProperty('dependencies');
      expect(body.data).toHaveProperty('jobs');
      expect(body.data).toHaveProperty('checkedAt');
    });

    it('returns dependency statuses', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = res.json();

      expect(body.data.dependencies).toHaveLength(5);
      expect(body.data.dependencies[0]).toHaveProperty('name');
      expect(body.data.dependencies[0]).toHaveProperty('available');
    });

    it('returns job counts', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = res.json();

      expect(body.data.jobs.active).toBe(2);
      expect(body.data.jobs.queued).toBe(1);
    });

    it('returns uptime as a number', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      const body = res.json();

      expect(typeof body.data.uptime).toBe('number');
      expect(body.data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('returns "degraded" when not all deps healthy', async () => {
      mockChecker.getReport.mockResolvedValueOnce({
        healthy: false,
        dependencies: [],
        checkedAt: '2026-03-31T00:00:00Z',
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.json().data.status).toBe('degraded');
    });

    it('returns "ok" when all deps healthy', async () => {
      mockChecker.getReport.mockResolvedValueOnce({
        healthy: true,
        dependencies: [],
        checkedAt: '2026-03-31T00:00:00Z',
      });

      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.json().data.status).toBe('ok');
    });
  });

  // -----------------------------------------------------------------------
  // POST /health/refresh
  // -----------------------------------------------------------------------

  describe('POST /health/refresh', () => {
    it('calls refresh on the health checker', async () => {
      const res = await app.inject({ method: 'POST', url: '/health/refresh' });

      expect(res.statusCode).toBe(200);
      expect(mockChecker.refresh).toHaveBeenCalled();
    });

    it('returns refreshed health data', async () => {
      const res = await app.inject({ method: 'POST', url: '/health/refresh' });
      const body = res.json();

      expect(body.success).toBe(true);
      expect(body.command).toBe('health.refresh');
      expect(body.data).toHaveProperty('status');
      expect(body.data).toHaveProperty('dependencies');
    });

    it('returns 500 when refresh fails', async () => {
      mockChecker.refresh.mockRejectedValueOnce(new Error('check failed'));

      const res = await app.inject({ method: 'POST', url: '/health/refresh' });

      expect(res.statusCode).toBe(500);
      expect(res.json().error.code).toBe('HEALTH_REFRESH_FAILED');
    });
  });
});
