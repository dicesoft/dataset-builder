import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobStatus, JobRecord, JobProgress, JobError } from './types';

/**
 * T087: Unit tests for job manager
 */

// ---------------------------------------------------------------------------
// Mock persistence layer
// ---------------------------------------------------------------------------

const mockSaveJob = vi.fn().mockResolvedValue(undefined);
const mockGetJob = vi.fn<(id: string) => Promise<JobRecord | null>>();
const mockListJobs = vi.fn().mockResolvedValue([]);
const mockDeleteJob = vi.fn().mockResolvedValue(true);

vi.mock('./persistence', () => ({
  saveJob: (...args: unknown[]) => mockSaveJob(...args),
  getJob: (...args: unknown[]) => mockGetJob(...args),
  listJobs: (...args: unknown[]) => mockListJobs(...args),
  deleteJob: (...args: unknown[]) => mockDeleteJob(...args),
}));

// ---------------------------------------------------------------------------
// Mock executor - track instances and allow control
// ---------------------------------------------------------------------------

const executorInstances: Array<{
  run: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
  isRunning: boolean;
  _listeners: Map<string, Array<(...args: unknown[]) => void>>;
}> = [];

vi.mock('./executor', () => {
  return {
    JobExecutor: class MockJobExecutor {
      run = vi.fn().mockResolvedValue(undefined);
      cancel = vi.fn();
      _listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      isRunning = true;

      on(event: string, handler: (...args: unknown[]) => void) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event)!.push(handler);
        return this;
      }

      emit(event: string, ...args: unknown[]) {
        for (const handler of this._listeners.get(event) ?? []) {
          handler(...args);
        }
      }

      constructor() {
        executorInstances.push(this as any);
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Mock health checker
// ---------------------------------------------------------------------------

vi.mock('../health/checker', () => ({
  checkDependenciesForCommand: vi.fn().mockResolvedValue({ ok: true, missing: [] }),
}));

// Mock the config so outputPath normalization is deterministic
vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => (key === 'outputDir' ? 'output' : undefined),
  }),
}));

// ---------------------------------------------------------------------------
// Mock task ID generator
// ---------------------------------------------------------------------------

let taskIdCounter = 0;
vi.mock('../../utils/taskManager', () => ({
  generateTaskId: () => `job-${++taskIdCounter}`,
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { JobManager } from './manager';

// Store for simulating persistence
const jobStore = new Map<string, JobRecord>();

describe('JobManager', () => {
  let manager: JobManager;

  beforeEach(() => {
    taskIdCounter = 0;
    executorInstances.length = 0;
    jobStore.clear();

    // Wire mockGetJob to the store
    mockGetJob.mockImplementation(async (id: string) => {
      const job = jobStore.get(id);
      return job ? { ...job } : null;
    });

    // Wire mockSaveJob to the store
    mockSaveJob.mockImplementation(async (job: JobRecord) => {
      jobStore.set(job.id, { ...job });
    });

    mockListJobs.mockResolvedValue([]);
    mockDeleteJob.mockResolvedValue(true);

    manager = new JobManager(2); // concurrency limit = 2
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Job creation
  // -----------------------------------------------------------------------

  describe('createJob', () => {
    it('creates a job with queued status', async () => {
      const job = await manager.createJob('scrape', { search: 'test' });

      expect(job.id).toBe('job-1');
      expect(job.command).toBe('scrape');
      expect(job.status).toBe(JobStatus.queued);
      expect(job.options).toEqual({ search: 'test' });
      expect(mockSaveJob).toHaveBeenCalled();
    });

    it('accepts CreateJobRequest object', async () => {
      const job = await manager.createJob({ command: 'generate', options: { count: 10 } });

      expect(job.command).toBe('generate');
      expect(job.options).toEqual({ count: 10 });
    });

    it('rejects job when dependencies are missing', async () => {
      const { checkDependenciesForCommand } = await import('../health/checker');
      (checkDependenciesForCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        missing: [{ name: 'python', available: false }],
      });

      await expect(manager.createJob('scrape', {})).rejects.toThrow(
        /Missing required dependencies/
      );
    });
  });

  // -----------------------------------------------------------------------
  // Concurrency limit
  // -----------------------------------------------------------------------

  describe('concurrency limit', () => {
    it('starts jobs up to the concurrency limit', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});

      expect(executorInstances).toHaveLength(2);
      expect(manager.runningCount).toBe(2);
    });

    it('queues jobs beyond the concurrency limit', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      await manager.createJob('transform', {});

      // Only 2 should be running, 1 queued
      expect(executorInstances).toHaveLength(2);
      expect(manager.runningCount).toBe(2);
      expect(manager.queuedCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Queue ordering (FIFO)
  // -----------------------------------------------------------------------

  describe('queue ordering', () => {
    it('processes queued jobs in FIFO order', async () => {
      // Fill concurrency slots
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      // These go to queue
      await manager.createJob('transform', {});
      await manager.createJob('translate', {});

      expect(manager.queuedCount).toBe(2);

      // Complete the first job - should start the third
      const firstExecutor = executorInstances[0];
      firstExecutor.emit('complete', null);

      // Allow async processing
      await new Promise((r) => setTimeout(r, 10));

      // The third executor should have been created for 'transform'
      expect(executorInstances).toHaveLength(3);
      expect(manager.queuedCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Auto-start on completion
  // -----------------------------------------------------------------------

  describe('auto-start queued jobs', () => {
    it('starts next queued job when a running job completes', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      await manager.createJob('transform', {});

      expect(executorInstances).toHaveLength(2);
      expect(manager.queuedCount).toBe(1);

      // Complete the first job
      executorInstances[0].emit('complete', { result: 'done' });
      await new Promise((r) => setTimeout(r, 10));

      expect(executorInstances).toHaveLength(3);
      expect(manager.queuedCount).toBe(0);
    });

    it('starts next queued job when a running job fails', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      await manager.createJob('transform', {});

      // Fail the first job
      executorInstances[0].emit('error', {
        code: 'TEST_ERROR',
        message: 'test failure',
        details: null,
      } as JobError);
      await new Promise((r) => setTimeout(r, 10));

      expect(executorInstances).toHaveLength(3);
      expect(manager.queuedCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  describe('cancelJob', () => {
    it('cancels a queued job by removing from queue', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      const queued = await manager.createJob('transform', {});

      const cancelled = await manager.cancelJob(queued.id);
      expect(cancelled!.status).toBe(JobStatus.cancelled);
      expect(manager.queuedCount).toBe(0);
    });

    it('cancels a running job by killing the executor', async () => {
      const job = await manager.createJob('scrape', {});

      const cancelled = await manager.cancelJob(job.id);
      expect(cancelled).not.toBeNull();
      expect(executorInstances[0].cancel).toHaveBeenCalled();
    });

    it('returns null for non-existent job', async () => {
      const result = await manager.cancelJob('nonexistent');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Resume
  // -----------------------------------------------------------------------

  describe('resumeJob', () => {
    it('resumes a failed job by re-queuing it', async () => {
      const job = await manager.createJob('scrape', {});

      // Simulate failure
      executorInstances[0].emit('error', {
        code: 'FAIL',
        message: 'failed',
        details: null,
      } as JobError);
      await new Promise((r) => setTimeout(r, 10));

      const resumed = await manager.resumeJob(job.id);
      expect(resumed!.status).toBe(JobStatus.queued);
      expect(resumed!.error).toBeNull();
    });

    it('resumes an interrupted job', async () => {
      const job = await manager.createJob('scrape', {});

      // Manually mark as interrupted in the store
      const stored = jobStore.get(job.id)!;
      stored.status = JobStatus.interrupted;
      jobStore.set(job.id, stored);

      const resumed = await manager.resumeJob(job.id);
      expect(resumed!.status).toBe(JobStatus.queued);
    });

    it('throws when trying to resume a completed job', async () => {
      const job = await manager.createJob('scrape', {});

      // Mark as completed
      const stored = jobStore.get(job.id)!;
      stored.status = JobStatus.completed;
      jobStore.set(job.id, stored);

      await expect(manager.resumeJob(job.id)).rejects.toThrow(/Cannot resume/);
    });

    it('returns null for non-existent job', async () => {
      const result = await manager.resumeJob('nonexistent');
      expect(result).toBeNull();
    });

    // ---------------------------------------------------------------------
    // Phase 4.5 — Resume portability regression (plan §4.5 / R6).
    //
    // Jobs persist `options.input` as a RELATIVE path (that's how they come
    // in from the datasets API). The executor resolves that relative value
    // against `config.outputDir` at the moment it spawns the child process.
    //
    // Invariant: on resume, the manager must forward the same relative
    // `options.input` to the executor — it must NOT freeze an absolutized
    // path at createJob time. That way the executor re-resolves against
    // whatever outputDir is currently configured, producing EITHER success
    // at the new location OR an explicit INPUT_FILE_MISSING error — never
    // silent misdirection at an old, resolved path.
    // ---------------------------------------------------------------------
    it('forwards the original relative options.input on resume (plan §4.5 / R6)', async () => {
      const relativeInput = 'task_resume/scraped.json';
      const job = await manager.createJob('transform', {
        input: relativeInput,
        template: 'image-classification',
      });

      // First run: simulate failure.
      executorInstances[0].emit('error', {
        code: 'CLI_EXIT_ERROR',
        message: 'boom',
        details: null,
      } as JobError);
      await new Promise((r) => setTimeout(r, 10));

      // Record the run() arg that was used on first start.
      const firstRunCall = executorInstances[0].run.mock.calls[0];
      expect(firstRunCall[0]).toBe('transform');
      expect((firstRunCall[1] as { input: string }).input).toBe(relativeInput);

      // Resume — a fresh executor instance should pick up and receive the
      // SAME (unmodified) relative input, so the executor gets a chance to
      // re-resolve against the current outputDir.
      const resumed = await manager.resumeJob(job.id);
      expect(resumed!.status).toBe(JobStatus.queued);
      await new Promise((r) => setTimeout(r, 10));

      const secondExecutor = executorInstances[executorInstances.length - 1];
      expect(secondExecutor).not.toBe(executorInstances[0]);
      const secondRunCall = secondExecutor.run.mock.calls[0];
      expect(secondRunCall[0]).toBe('transform');
      const secondOptions = secondRunCall[1] as { input: string };
      // Unmodified passthrough — no pre-absolutization at the manager layer.
      expect(secondOptions.input).toBe(relativeInput);
      // And — the crucial part — still relative (the whole point of the
      // regression test). If the manager had silently frozen an absolute
      // path, this would fail.
      expect(
        secondOptions.input.startsWith('/') || /^[A-Za-z]:[\\/]/.test(secondOptions.input)
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  describe('deleteJob', () => {
    it('deletes a completed job', async () => {
      const job = await manager.createJob('scrape', {});

      // Mark as completed
      const stored = jobStore.get(job.id)!;
      stored.status = JobStatus.completed;
      jobStore.set(job.id, stored);

      const result = await manager.deleteJob(job.id);
      expect(result).toBe(true);
      expect(mockDeleteJob).toHaveBeenCalledWith(job.id);
    });

    it('throws when trying to delete a running job', async () => {
      const job = await manager.createJob('scrape', {});

      await expect(manager.deleteJob(job.id)).rejects.toThrow(/Cannot delete/);
    });

    it('returns false for non-existent job', async () => {
      const result = await manager.deleteJob('nonexistent');
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  describe('shutdown', () => {
    it('marks running jobs as interrupted', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});

      await manager.shutdown();

      // Check that executors were cancelled
      expect(executorInstances[0].cancel).toHaveBeenCalled();
      expect(executorInstances[1].cancel).toHaveBeenCalled();

      // Check that jobs were saved as interrupted
      const savedCalls = mockSaveJob.mock.calls;
      const interruptedSaves = savedCalls.filter(
        (call: unknown[]) => (call[0] as JobRecord).status === JobStatus.interrupted
      );
      expect(interruptedSaves.length).toBeGreaterThanOrEqual(2);
    });

    it('marks queued jobs as interrupted', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      await manager.createJob('transform', {}); // queued

      await manager.shutdown();

      // The queued job should also be interrupted
      const savedCalls = mockSaveJob.mock.calls;
      const interruptedSaves = savedCalls.filter(
        (call: unknown[]) => (call[0] as JobRecord).status === JobStatus.interrupted
      );
      // At least 3 interrupted saves (2 running + 1 queued)
      expect(interruptedSaves.length).toBeGreaterThanOrEqual(3);
    });

    it('prevents new jobs from starting after shutdown', async () => {
      await manager.createJob('scrape', {});
      await manager.createJob('generate', {});
      await manager.createJob('transform', {}); // queued

      await manager.shutdown();

      expect(manager.runningCount).toBe(0);
      expect(manager.queuedCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // outputPath extraction from result
  // -----------------------------------------------------------------------

  describe('outputPath extraction', () => {
    it('strips the output/ prefix from outputFile (relative path)', async () => {
      await manager.createJob('scrape', {});

      executorInstances[0].emit('complete', {
        outputFile: 'output/task_123/scrape-results.jsonl',
        records: 42,
      });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      // outputDir mock = "output", so this normalizes to "task_123/scrape-results.jsonl"
      expect(saved!.outputPath).toBe('task_123/scrape-results.jsonl');
    });

    it('strips the output/ prefix from outputDir (relative path)', async () => {
      await manager.createJob('download', {});

      executorInstances[0].emit('complete', {
        outputDir: 'output/downloads',
        filesDownloaded: 10,
      });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBe('downloads');
    });

    it('prefers outputFile over outputDir', async () => {
      await manager.createJob('scrape', {});

      executorInstances[0].emit('complete', {
        outputFile: 'output/task_a/file.jsonl',
        outputDir: 'output/task_a',
      });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBe('task_a/file.jsonl');
    });

    it('leaves outputPath null when result is null', async () => {
      await manager.createJob('scrape', {});

      executorInstances[0].emit('complete', null);
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBeNull();
    });

    it('leaves outputPath null when result has no outputFile or outputDir', async () => {
      await manager.createJob('scrape', {});

      executorInstances[0].emit('complete', { records: 10, urlsScraped: 5 });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBeNull();
    });

    it('leaves outputPath null when outputFile is not a string', async () => {
      await manager.createJob('scrape', {});

      executorInstances[0].emit('complete', { outputFile: 123 });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBeNull();
    });

    it('normalizes Windows backslashes and strips output/ prefix in outputPath', async () => {
      await manager.createJob('scrape', {});

      executorInstances[0].emit('complete', {
        outputFile: 'output\\task_123\\scraped_combined.json',
      });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBe('task_123/scraped_combined.json');
    });

    it('normalizes Windows backslashes and strips output/ in outputDir', async () => {
      await manager.createJob('download', {});

      executorInstances[0].emit('complete', {
        outputDir: 'output\\downloads\\images',
      });
      await new Promise((r) => setTimeout(r, 10));

      const saved = jobStore.get('job-1');
      expect(saved!.outputPath).toBe('downloads/images');
    });
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  describe('events', () => {
    it('emits job:status on creation', async () => {
      const events: unknown[] = [];
      manager.on('job:status', (id, record) => events.push({ id, status: record.status }));

      await manager.createJob('scrape', {});

      // Should get queued + running status events
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toMatchObject({ status: JobStatus.queued });
    });

    it('emits job:progress when executor reports progress', async () => {
      const progressEvents: unknown[] = [];
      manager.on('job:progress', (id, progress) => progressEvents.push({ id, progress }));

      await manager.createJob('scrape', {});

      const progress: JobProgress = {
        phase: 'Downloading',
        current: 5,
        total: 10,
        counters: null,
        message: null,
        throughput: null,
      };
      executorInstances[0].emit('progress', progress);

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({
        progress: { phase: 'Downloading', current: 5 },
      });
    });

    it('emits job:log when executor emits a log line', async () => {
      const logEvents: unknown[] = [];
      manager.on('job:log', (id, line) => logEvents.push({ id, line }));

      await manager.createJob('scrape', {});

      executorInstances[0].emit('log', 'Fetching page 1 of 5');
      executorInstances[0].emit('log', 'Fetching page 2 of 5');

      expect(logEvents).toHaveLength(2);
      expect(logEvents[0]).toMatchObject({ id: 'job-1', line: 'Fetching page 1 of 5' });
      expect(logEvents[1]).toMatchObject({ id: 'job-1', line: 'Fetching page 2 of 5' });

      // Also verify logs are stored in the job record
      const saved = jobStore.get('job-1');
      expect(saved!.logs).toEqual(['Fetching page 1 of 5', 'Fetching page 2 of 5']);
    });

    it('emits job:error when executor reports error', async () => {
      const errorEvents: unknown[] = [];
      manager.on('job:error', (id, error) => errorEvents.push({ id, error }));

      await manager.createJob('scrape', {});

      executorInstances[0].emit('error', {
        code: 'TEST_ERROR',
        message: 'something failed',
        details: null,
      } as JobError);

      await new Promise((r) => setTimeout(r, 10));

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        error: { code: 'TEST_ERROR' },
      });
    });
  });
});
