import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jobsRoutes from './jobs';
import { JobStatus, JobRecord } from '../jobs/types';

/**
 * T090: Contract tests for Jobs API routes
 */

// ---------------------------------------------------------------------------
// Mock JobManager
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'test-job-1',
    command: 'scrape',
    options: {},
    status: JobStatus.queued,
    progress: null,
    createdAt: '2026-03-31T14:00:00Z',
    startedAt: null,
    completedAt: null,
    duration: null,
    outputPath: null,
    error: null,
    result: null,
    checkpointPath: null,
    logs: [],
    ...overrides,
  };
}

function createMockJobManager() {
  return {
    createJob: vi.fn(),
    getJob: vi.fn(),
    listJobs: vi.fn(),
    cancelJob: vi.fn(),
    resumeJob: vi.fn(),
    deleteJob: vi.fn(),
  };
}

describe('Jobs API routes', () => {
  let app: FastifyInstance;
  let mockManager: ReturnType<typeof createMockJobManager>;

  beforeEach(async () => {
    mockManager = createMockJobManager();
    app = Fastify({ logger: false });
    await app.register(jobsRoutes, { jobManager: mockManager as any });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // POST /jobs
  // -----------------------------------------------------------------------

  describe('POST /jobs', () => {
    it('creates a job and returns 201', async () => {
      const job = makeJob();
      mockManager.createJob.mockResolvedValue(job);

      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape', options: { search: 'test' } },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.version).toBe(1);
      expect(body.success).toBe(true);
      expect(body.command).toBe('jobs.create');
      expect(body.data.id).toBe('test-job-1');
    });

    it('returns 400 for missing command', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { options: {} },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 for unknown command', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'nonexistent' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('INVALID_COMMAND');
    });

    it('returns 400 for invalid options type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape', options: 'not-an-object' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when body is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 500 when createJob throws', async () => {
      mockManager.createJob.mockRejectedValue(new Error('Missing deps'));

      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error.code).toBe('JOB_CREATE_FAILED');
    });
  });

  // -----------------------------------------------------------------------
  // GET /jobs
  // -----------------------------------------------------------------------

  describe('GET /jobs', () => {
    it('returns job list with envelope format', async () => {
      mockManager.listJobs.mockResolvedValue([
        makeJob({ id: 'j1', createdAt: '2026-01-01T00:00:00Z' }),
        makeJob({ id: 'j2', createdAt: '2026-01-02T00:00:00Z' }),
      ]);

      const res = await app.inject({ method: 'GET', url: '/jobs' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.command).toBe('jobs.list');
      expect(body.data.jobs).toHaveLength(2);
      expect(body.data.total).toBe(2);
      expect(body.data).toHaveProperty('limit');
      expect(body.data).toHaveProperty('offset');
    });

    it('passes status filter to manager', async () => {
      mockManager.listJobs.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/jobs?status=running' });

      expect(mockManager.listJobs).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' })
      );
    });

    it('passes command filter to manager', async () => {
      mockManager.listJobs.mockResolvedValue([]);

      await app.inject({ method: 'GET', url: '/jobs?command=scrape' });

      expect(mockManager.listJobs).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'scrape' })
      );
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await app.inject({ method: 'GET', url: '/jobs?status=invalid' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_INPUT');
    });
  });

  // -----------------------------------------------------------------------
  // GET /jobs/:id
  // -----------------------------------------------------------------------

  describe('GET /jobs/:id', () => {
    it('returns a single job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ id: 'j1' }));

      const res = await app.inject({ method: 'GET', url: '/jobs/j1' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe('j1');
    });

    it('returns 404 for non-existent job', async () => {
      mockManager.getJob.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/jobs/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  // -----------------------------------------------------------------------
  // POST /jobs/:id/cancel
  // -----------------------------------------------------------------------

  describe('POST /jobs/:id/cancel', () => {
    it('cancels a running job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ id: 'j1', status: JobStatus.running }));
      mockManager.cancelJob.mockResolvedValue(makeJob({ id: 'j1', status: JobStatus.cancelled }));

      const res = await app.inject({ method: 'POST', url: '/jobs/j1/cancel' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('cancelled');
    });

    it('returns 404 for non-existent job', async () => {
      mockManager.getJob.mockResolvedValue(null);

      const res = await app.inject({ method: 'POST', url: '/jobs/nonexistent/cancel' });
      expect(res.statusCode).toBe(404);
    });

    it('returns 409 for completed job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ status: JobStatus.completed }));

      const res = await app.inject({ method: 'POST', url: '/jobs/j1/cancel' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('INVALID_STATE');
    });
  });

  // -----------------------------------------------------------------------
  // POST /jobs/:id/resume
  // -----------------------------------------------------------------------

  describe('POST /jobs/:id/resume', () => {
    it('resumes a failed job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ id: 'j1', status: JobStatus.failed }));
      mockManager.resumeJob.mockResolvedValue(makeJob({ id: 'j1', status: JobStatus.queued }));

      const res = await app.inject({ method: 'POST', url: '/jobs/j1/resume' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('queued');
    });

    it('returns 409 for running job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ status: JobStatus.running }));

      const res = await app.inject({ method: 'POST', url: '/jobs/j1/resume' });
      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for non-existent job', async () => {
      mockManager.getJob.mockResolvedValue(null);

      const res = await app.inject({ method: 'POST', url: '/jobs/nonexistent/resume' });
      expect(res.statusCode).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /jobs/:id
  // -----------------------------------------------------------------------

  describe('DELETE /jobs/:id', () => {
    it('deletes a completed job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ id: 'j1', status: JobStatus.completed }));
      mockManager.deleteJob.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/jobs/j1' });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.deleted).toBe(true);
    });

    it('returns 404 for non-existent job', async () => {
      mockManager.getJob.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: '/jobs/nonexistent' });
      expect(res.statusCode).toBe(404);
    });

    it('returns 409 for running job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ status: JobStatus.running }));

      const res = await app.inject({ method: 'DELETE', url: '/jobs/j1' });
      expect(res.statusCode).toBe(409);
    });

    it('returns 409 for queued job', async () => {
      mockManager.getJob.mockResolvedValue(makeJob({ status: JobStatus.queued }));

      const res = await app.inject({ method: 'DELETE', url: '/jobs/j1' });
      expect(res.statusCode).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // 7.7: Server-side option validation
  // -----------------------------------------------------------------------

  describe('POST /jobs option validation (7.7)', () => {
    it('returns 400 for invalid single-value choice option', async () => {
      // scrape command has --output-format with choices ['json','jsonl','csv','xml']
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape', options: { outputFormat: 'invalid-format' } },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_OPTION_VALUE');
      expect(body.error.message).toContain('invalid-format');
      expect(body.error.message).toContain('Valid values');
    });

    it('accepts valid choice option values', async () => {
      const job = makeJob();
      mockManager.createJob.mockResolvedValue(job);

      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape', options: { outputFormat: 'json' } },
      });

      expect(res.statusCode).toBe(201);
    });

    it('validates each value in comma-separated multi-value fields', async () => {
      // generate command has --format with choices ['json','jsonl','csv']
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'generate', options: { format: 'json,invalid' } },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('INVALID_OPTION_VALUE');
      expect(body.error.message).toContain('invalid');
    });

    it('passes through options without defined choices (forward-compat)', async () => {
      const job = makeJob({ command: 'scrape' });
      mockManager.createJob.mockResolvedValue(job);

      // 'search' is not a choice-restricted option — should pass through
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape', options: { search: 'anything goes here' } },
      });

      expect(res.statusCode).toBe(201);
    });

    it('skips validation when options is empty or undefined', async () => {
      const job = makeJob();
      mockManager.createJob.mockResolvedValue(job);

      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape' },
      });

      expect(res.statusCode).toBe(201);
    });

    it('skips validation for empty string option values', async () => {
      const job = makeJob();
      mockManager.createJob.mockResolvedValue(job);

      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'scrape', options: { outputFormat: '' } },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // -----------------------------------------------------------------------
  // Envelope format
  // -----------------------------------------------------------------------

  describe('envelope format', () => {
    it('success responses have version=1, success=true, command, data', async () => {
      mockManager.listJobs.mockResolvedValue([]);

      const res = await app.inject({ method: 'GET', url: '/jobs' });
      const body = res.json();

      expect(body.version).toBe(1);
      expect(body.success).toBe(true);
      expect(body.command).toBe('jobs.list');
      expect(body).toHaveProperty('data');
    });

    it('error responses have version=1, success=false, error with code/message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { command: 'nonexistent' },
      });
      const body = res.json();

      expect(body.version).toBe(1);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });
});
