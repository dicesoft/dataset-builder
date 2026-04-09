/**
 * Phase 4.3 — POST /jobs → spawn argv integration test.
 *
 * Spies on `child_process.spawn`, POSTs a transform job to the real Fastify
 * instance (real JobManager + real JobExecutor), and asserts that the child
 * process argv contains the **absolute resolved path** under outputDir — not
 * the raw relative path submitted via the API.
 *
 * This locks in the end-to-end Bug B regression across the HTTP layer →
 * JobManager → JobExecutor boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import { getConfig } from '../../config';

// ---------------------------------------------------------------------------
// Mock persistence so tests don't touch the filesystem
// ---------------------------------------------------------------------------

// Simple in-memory persistence store so JobManager.startJob() can find the
// job it just queued (createJob → queue → processQueue → startJob → getJob).
const jobStore = new Map<string, import('../jobs/types').JobRecord>();
vi.mock('../jobs/persistence', () => ({
  saveJob: vi.fn(async (job: import('../jobs/types').JobRecord) => {
    jobStore.set(job.id, { ...job });
  }),
  getJob: vi.fn(async (id: string) => {
    const j = jobStore.get(id);
    return j ? { ...j } : null;
  }),
  listJobs: vi.fn().mockResolvedValue([]),
  deleteJob: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Mock health checker so deps don't block the job
// ---------------------------------------------------------------------------

vi.mock('../health/checker', () => ({
  checkDependenciesForCommand: vi.fn().mockResolvedValue({ ok: true, missing: [] }),
  HealthChecker: class {
    check = vi.fn().mockResolvedValue({});
  },
}));

// ---------------------------------------------------------------------------
// Mock child_process.spawn to intercept the argv
// ---------------------------------------------------------------------------

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function createMockProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 54321;
  return proc;
}

let lastMockProcess: MockChildProcess;
const spawnSpy = vi.fn(() => {
  lastMockProcess = createMockProcess();
  // Exit successfully on next tick so the executor's close handler runs
  // and the test doesn't hang.
  setImmediate(() => lastMockProcess.emit('close', 0));
  return lastMockProcess;
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnSpy(...(args as [])),
  };
});

// ---------------------------------------------------------------------------
// Import under test — after mocks
// ---------------------------------------------------------------------------

import jobsRoutes from './jobs';
import { JobManager } from '../jobs/manager';

describe('POST /jobs → spawn argv integration (Phase 4.3)', () => {
  let app: FastifyInstance;
  let jobManager: JobManager;

  beforeEach(async () => {
    spawnSpy.mockClear();
    jobStore.clear();
    jobManager = new JobManager(2);

    app = Fastify({ logger: false });
    await app.register(jobsRoutes, { jobManager: jobManager as any });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await jobManager.shutdown();
    vi.clearAllMocks();
  });

  it('absolutizes a dataset-relative --input path before spawning the CLI', async () => {
    const relativeInput = 'task_e2e/scraped_combined.json';

    const res = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        command: 'transform',
        options: {
          input: relativeInput,
          template: 'image-classification',
        },
      },
    });

    expect(res.statusCode).toBe(201);

    // Allow the microtask queue to flush so JobManager actually calls
    // executor.run (which invokes our spawn spy).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, args] = spawnSpy.mock.calls[0] as unknown as [string, string[]];

    const inputIdx = args.indexOf('--input');
    expect(inputIdx).toBeGreaterThan(-1);
    const resolved = args[inputIdx + 1];

    // Absolute — not the raw relative path sent by the client.
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).not.toBe(relativeInput);

    // Contained within the configured outputDir.
    const outputDir = path.resolve(getConfig().get('outputDir') as string);
    const outputDirWithSep = outputDir.endsWith(path.sep) ? outputDir : outputDir + path.sep;
    expect(resolved.startsWith(outputDirWithSep)).toBe(true);

    // Carries the original relative tail.
    expect(resolved.replace(/\\/g, '/')).toContain(relativeInput);
  });
});
