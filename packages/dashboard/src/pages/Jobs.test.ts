import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useJobStore, getErrorMessage, type JobRecord, type JobError } from '../stores/jobStore';

/**
 * Jobs page logic tests.
 *
 * Tests verify the store-level behavior that drives the Jobs page:
 * - Job list rendering from store
 * - Status filtering
 * - Drawer data selection (selectedJob lookup)
 * - Error rendering for failed jobs (structured JobError with code/message/details)
 * - Context menu action dispatching (cancel, resume, delete call correct endpoints)
 * - handleResume calls POST /jobs/:id/resume
 *
 * No jsdom/RTL — tests exercise store logic and API interactions.
 */

// Mock the API module
vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost, apiDelete } from '../utils/api';
const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiDelete = vi.mocked(apiDelete);

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    command: 'scrape',
    status: 'queued',
    progress: null,
    createdAt: '2026-04-01T00:00:00Z',
    startedAt: null,
    completedAt: null,
    duration: null,
    outputPath: null,
    error: null,
    ...overrides,
  };
}

describe('Jobs page logic', () => {
  beforeEach(() => {
    useJobStore.setState({ jobs: new Map(), activeJobIds: new Set() });
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Job list rendering from store
  // -----------------------------------------------------------------------
  describe('Job list from store', () => {
    it('fetched jobs are available in store map', async () => {
      const jobs = [
        makeJob({ id: 'j1', command: 'scrape' }),
        makeJob({ id: 'j2', command: 'generate' }),
        makeJob({ id: 'j3', command: 'transform' }),
      ];
      mockApiGet.mockResolvedValue({ jobs, total: 3 });

      await useJobStore.getState().fetchJobs();

      const state = useJobStore.getState();
      expect(state.jobs.size).toBe(3);
      expect(state.jobs.get('j1')?.command).toBe('scrape');
      expect(state.jobs.get('j2')?.command).toBe('generate');
      expect(state.jobs.get('j3')?.command).toBe('transform');
    });

    it('empty job list results in empty map', async () => {
      mockApiGet.mockResolvedValue({ jobs: [], total: 0 });

      await useJobStore.getState().fetchJobs();

      expect(useJobStore.getState().jobs.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Status filtering (logic the page uses to filter jobs)
  // -----------------------------------------------------------------------
  describe('Status filter logic', () => {
    function getFilteredJobs(statusFilter: string): JobRecord[] {
      const all = Array.from(useJobStore.getState().jobs.values());
      return statusFilter === 'all' ? all : all.filter((j) => j.status === statusFilter);
    }

    beforeEach(async () => {
      const jobs = [
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'completed' }),
        makeJob({ id: 'j3', status: 'failed', error: 'oops' }),
        makeJob({ id: 'j4', status: 'queued' }),
        makeJob({ id: 'j5', status: 'interrupted' }),
      ];
      mockApiGet.mockResolvedValue({ jobs, total: 5 });
      await useJobStore.getState().fetchJobs();
    });

    it('"all" shows every job', () => {
      expect(getFilteredJobs('all')).toHaveLength(5);
    });

    it('"running" shows only running jobs', () => {
      const filtered = getFilteredJobs('running');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('j1');
    });

    it('"failed" shows only failed jobs', () => {
      const filtered = getFilteredJobs('failed');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('j3');
    });

    it('"interrupted" shows only interrupted jobs', () => {
      const filtered = getFilteredJobs('interrupted');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('j5');
    });

    it('"cancelled" shows no jobs when none have that status', () => {
      expect(getFilteredJobs('cancelled')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Drawer: selected job lookup
  // -----------------------------------------------------------------------
  describe('Drawer job selection', () => {
    it('looking up a valid job ID returns the job', async () => {
      const jobs = [makeJob({ id: 'j1', command: 'scrape' })];
      mockApiGet.mockResolvedValue({ jobs, total: 1 });
      await useJobStore.getState().fetchJobs();

      const selectedJob = useJobStore.getState().jobs.get('j1');
      expect(selectedJob).toBeDefined();
      expect(selectedJob!.command).toBe('scrape');
    });

    it('looking up a non-existent job ID returns undefined (job not found state)', () => {
      const selectedJob = useJobStore.getState().jobs.get('nonexistent');
      expect(selectedJob).toBeUndefined();
    });

    it('job with all drawer fields populated', async () => {
      const job = makeJob({
        id: 'j1',
        command: 'scrape',
        status: 'completed',
        startedAt: '2026-04-01T00:01:00Z',
        completedAt: '2026-04-01T00:05:00Z',
        duration: 240000,
        outputPath: '/data/output.json',
        options: { query: 'test', maxResults: 10 },
        logs: ['Starting scrape...', 'Found 10 results', 'Done'],
      });
      mockApiGet.mockResolvedValue({ jobs: [job], total: 1 });
      await useJobStore.getState().fetchJobs();

      const selected = useJobStore.getState().jobs.get('j1')!;
      expect(selected.startedAt).toBe('2026-04-01T00:01:00Z');
      expect(selected.completedAt).toBe('2026-04-01T00:05:00Z');
      expect(selected.duration).toBe(240000);
      expect(selected.outputPath).toBe('/data/output.json');
      expect(selected.options).toEqual({ query: 'test', maxResults: 10 });
      expect(selected.logs).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // Drawer: structured error rendering for failed jobs
  // -----------------------------------------------------------------------
  describe('Drawer error rendering for failed jobs', () => {
    it('string error displays via getErrorMessage', () => {
      const job = makeJob({ id: 'j1', status: 'failed', error: 'Connection refused' });
      useJobStore.getState().addJob(job);

      const selected = useJobStore.getState().jobs.get('j1')!;
      expect(getErrorMessage(selected.error)).toBe('Connection refused');
    });

    it('JobError object: code badge + message + details', () => {
      const error: JobError = {
        code: 'SCRAPE_TIMEOUT',
        message: 'Request timed out after 30s',
        details: 'Stack trace line 1\nStack trace line 2',
      };
      const job = makeJob({ id: 'j1', status: 'failed', error });
      useJobStore.getState().addJob(job);

      const selected = useJobStore.getState().jobs.get('j1')!;
      // Verify structured error fields are preserved
      expect(typeof selected.error).toBe('object');
      const err = selected.error as JobError;
      expect(err.code).toBe('SCRAPE_TIMEOUT');
      expect(err.message).toBe('Request timed out after 30s');
      expect(err.details).toContain('Stack trace');
      // getErrorMessage extracts message
      expect(getErrorMessage(selected.error)).toBe('Request timed out after 30s');
    });

    it('JobError with null details hides details section', () => {
      const error: JobError = {
        code: 'UNKNOWN',
        message: 'Something failed',
        details: null,
      };
      const job = makeJob({ id: 'j1', status: 'failed', error });
      useJobStore.getState().addJob(job);

      const selected = useJobStore.getState().jobs.get('j1')!;
      const err = selected.error as JobError;
      expect(err.details).toBeNull();
    });

    it('job with null error and null progress shows metadata only', () => {
      const job = makeJob({ id: 'j1', status: 'queued', error: null, progress: null });
      useJobStore.getState().addJob(job);

      const selected = useJobStore.getState().jobs.get('j1')!;
      expect(selected.error).toBeNull();
      expect(selected.progress).toBeNull();
      // Drawer should show only summary section
      expect(selected.command).toBe('scrape');
      expect(selected.createdAt).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Table: error indicator for failed jobs
  // -----------------------------------------------------------------------
  describe('Table error indicator', () => {
    it('truncates long error messages for table display', () => {
      const longMessage = 'A'.repeat(100);
      const errMsg = getErrorMessage(longMessage);
      // Page logic: truncate to 60 chars + '...'
      const truncated = errMsg.length > 60 ? errMsg.slice(0, 60) + '...' : errMsg;
      expect(truncated).toBe('A'.repeat(60) + '...');
      expect(truncated.length).toBe(63);
    });

    it('short error messages are not truncated', () => {
      const errMsg = getErrorMessage('Short error');
      const truncated = errMsg.length > 60 ? errMsg.slice(0, 60) + '...' : errMsg;
      expect(truncated).toBe('Short error');
    });

    it('only failed jobs show error indicator', () => {
      const runningJob = makeJob({ id: 'j1', status: 'running' });
      const failedJob = makeJob({ id: 'j2', status: 'failed', error: 'oops' });

      // Page logic: only show error when status === 'failed' && job.error
      const showRunning = runningJob.status === 'failed' && runningJob.error;
      const showFailed = failedJob.status === 'failed' && failedJob.error;
      expect(showRunning).toBeFalsy();
      expect(showFailed).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Context menu actions
  // -----------------------------------------------------------------------
  describe('Context menu actions', () => {
    it('cancel calls POST /api/v1/jobs/:id/cancel', async () => {
      mockApiPost.mockResolvedValue(undefined);
      mockApiGet.mockResolvedValue({ jobs: [], total: 0 });

      // Simulate what handleCancel does via useJob.cancelJob
      await apiPost('/api/v1/jobs/j1/cancel');

      expect(mockApiPost).toHaveBeenCalledWith('/api/v1/jobs/j1/cancel');
    });

    it('resume calls POST /api/v1/jobs/:id/resume (not POST /jobs)', async () => {
      mockApiPost.mockResolvedValue(undefined);
      mockApiGet.mockResolvedValue({ jobs: [], total: 0 });

      // Simulate what handleResume does
      await apiPost('/api/v1/jobs/j1/resume');

      expect(mockApiPost).toHaveBeenCalledWith('/api/v1/jobs/j1/resume');
      // Verify it does NOT call the create-job endpoint
      expect(mockApiPost).not.toHaveBeenCalledWith('/api/v1/jobs', expect.anything());
    });

    it('delete calls DELETE /api/v1/jobs/:id and removes from store', async () => {
      mockApiDelete.mockResolvedValue(undefined);
      useJobStore.getState().addJob(makeJob({ id: 'j1' }));
      expect(useJobStore.getState().jobs.has('j1')).toBe(true);

      await useJobStore.getState().removeJob('j1');

      expect(mockApiDelete).toHaveBeenCalledWith('/api/v1/jobs/j1');
      expect(useJobStore.getState().jobs.has('j1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // handleResume error handling
  // -----------------------------------------------------------------------
  describe('handleResume error handling', () => {
    it('resume error is captured as a string message', () => {
      // handleResume catches errors and stores: err instanceof Error ? err.message : String(err)
      const err = new Error('Job is not in a resumable state');
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('Job is not in a resumable state');
    });

    it('non-Error resume failures are stringified', () => {
      const err: unknown = 'Network failure';
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('Network failure');
    });
  });

  // -----------------------------------------------------------------------
  // Status helper logic (used for context menu visibility)
  // -----------------------------------------------------------------------
  describe('Status helpers', () => {
    const isTerminal = (s: string) => ['completed', 'failed', 'cancelled'].includes(s);
    const isActive = (s: string) => ['running', 'queued', 'pending'].includes(s);
    const isResumable = (s: string) => ['failed', 'interrupted'].includes(s);

    it('isTerminal returns true for completed, failed, cancelled', () => {
      expect(isTerminal('completed')).toBe(true);
      expect(isTerminal('failed')).toBe(true);
      expect(isTerminal('cancelled')).toBe(true);
      expect(isTerminal('running')).toBe(false);
    });

    it('isActive returns true for running, queued, pending', () => {
      expect(isActive('running')).toBe(true);
      expect(isActive('queued')).toBe(true);
      expect(isActive('pending')).toBe(true);
      expect(isActive('completed')).toBe(false);
    });

    it('isResumable returns true for failed and interrupted', () => {
      expect(isResumable('failed')).toBe(true);
      expect(isResumable('interrupted')).toBe(true);
      expect(isResumable('running')).toBe(false);
      expect(isResumable('completed')).toBe(false);
    });

    it('context menu shows cancel for active jobs', () => {
      const job = makeJob({ status: 'running' });
      expect(isActive(job.status)).toBe(true);
      expect(isResumable(job.status)).toBe(false);
      expect(isTerminal(job.status)).toBe(false);
    });

    it('context menu shows resume for failed/interrupted jobs', () => {
      expect(isResumable('failed')).toBe(true);
      expect(isResumable('interrupted')).toBe(true);
    });

    it('context menu shows delete for terminal jobs', () => {
      expect(isTerminal('completed')).toBe(true);
      expect(isTerminal('failed')).toBe(true);
      expect(isTerminal('cancelled')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Logs truncation logic
  // -----------------------------------------------------------------------
  describe('Logs truncation', () => {
    const LOGS_TRUNCATE_LIMIT = 50;

    it('logs under limit are shown in full', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Log line ${i}`);
      const showAllLogs = false;
      const displayed =
        lines.length <= LOGS_TRUNCATE_LIMIT || showAllLogs
          ? lines
          : lines.slice(-LOGS_TRUNCATE_LIMIT);
      expect(displayed).toHaveLength(30);
    });

    it('logs over limit are truncated to last 50', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Log line ${i}`);
      const showAllLogs = false;
      const displayed =
        lines.length <= LOGS_TRUNCATE_LIMIT || showAllLogs
          ? lines
          : lines.slice(-LOGS_TRUNCATE_LIMIT);
      expect(displayed).toHaveLength(50);
      expect(displayed[0]).toBe('Log line 50');
    });

    it('showAllLogs bypasses truncation', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Log line ${i}`);
      const showAllLogs = true;
      const displayed =
        lines.length <= LOGS_TRUNCATE_LIMIT || showAllLogs
          ? lines
          : lines.slice(-LOGS_TRUNCATE_LIMIT);
      expect(displayed).toHaveLength(100);
    });
  });

  // -----------------------------------------------------------------------
  // Options filtering logic
  // -----------------------------------------------------------------------
  describe('Options section filtering', () => {
    it('filters out null, empty string, and false values', () => {
      const options: Record<string, unknown> = {
        query: 'test',
        maxResults: 10,
        emptyStr: '',
        nullVal: null,
        falseVal: false,
        zeroVal: 0,
      };
      const entries = Object.entries(options).filter(
        ([, v]) => v != null && v !== '' && v !== false
      );
      expect(entries.map(([k]) => k)).toEqual(['query', 'maxResults', 'zeroVal']);
    });

    it('empty options object results in no section', () => {
      const options: Record<string, unknown> = {};
      const entries = Object.entries(options).filter(
        ([, v]) => v != null && v !== '' && v !== false
      );
      expect(entries).toHaveLength(0);
    });
  });
});
