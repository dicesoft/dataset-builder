import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useJobStore, JobRecord, getErrorMessage, JobError } from './jobStore';

/**
 * T091: Tests for jobStore — Zustand store for job management
 */

// Mock the API module
vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiDelete } from '../utils/api';
const mockApiGet = vi.mocked(apiGet);
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

describe('jobStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useJobStore.setState({ jobs: new Map(), activeJobIds: new Set() });
    vi.clearAllMocks();
  });

  describe('fetchJobs', () => {
    it('fetches jobs and populates the store', async () => {
      const jobs = [makeJob({ id: 'j1' }), makeJob({ id: 'j2', status: 'completed' })];
      mockApiGet.mockResolvedValue({ jobs, total: 2 });

      await useJobStore.getState().fetchJobs();

      const state = useJobStore.getState();
      expect(state.jobs.size).toBe(2);
      expect(state.jobs.get('j1')).toBeDefined();
      expect(state.jobs.get('j2')).toBeDefined();
    });

    it('correctly unwraps { jobs, total } response envelope', async () => {
      mockApiGet.mockResolvedValue({ jobs: [makeJob()], total: 1 });

      await useJobStore.getState().fetchJobs();

      expect(mockApiGet).toHaveBeenCalledWith('/api/v1/jobs');
      expect(useJobStore.getState().jobs.size).toBe(1);
    });

    it('derives activeJobIds from job statuses', async () => {
      const jobs = [
        makeJob({ id: 'j1', status: 'running' }),
        makeJob({ id: 'j2', status: 'completed' }),
        makeJob({ id: 'j3', status: 'queued' }),
      ];
      mockApiGet.mockResolvedValue({ jobs, total: 3 });

      await useJobStore.getState().fetchJobs();

      const activeIds = useJobStore.getState().activeJobIds;
      expect(activeIds.has('j1')).toBe(true);
      expect(activeIds.has('j3')).toBe(true);
      expect(activeIds.has('j2')).toBe(false);
    });
  });

  describe('addJob', () => {
    it('adds a job to the store', () => {
      const job = makeJob({ id: 'new-job' });
      useJobStore.getState().addJob(job);

      expect(useJobStore.getState().jobs.get('new-job')).toEqual(job);
    });

    it('updates activeJobIds when adding an active job', () => {
      useJobStore.getState().addJob(makeJob({ id: 'j1', status: 'running' }));
      expect(useJobStore.getState().activeJobIds.has('j1')).toBe(true);
    });
  });

  describe('updateJobProgress', () => {
    it('updates progress for an existing job', () => {
      useJobStore.getState().addJob(makeJob({ id: 'j1' }));

      const progress = {
        phase: 'downloading',
        current: 5,
        total: 10,
        counters: {},
        message: 'Downloading...',
        throughput: 2.5,
      };
      useJobStore.getState().updateJobProgress('j1', progress);

      expect(useJobStore.getState().jobs.get('j1')?.progress).toEqual(progress);
    });

    it('does nothing for a non-existent job', () => {
      const before = useJobStore.getState();
      useJobStore.getState().updateJobProgress('nonexistent', {
        phase: 'test',
        current: 0,
        total: 0,
        counters: {},
        message: '',
        throughput: 0,
      });
      expect(useJobStore.getState().jobs.size).toBe(before.jobs.size);
    });
  });

  describe('updateJobStatus', () => {
    it('updates status and recalculates activeJobIds', () => {
      useJobStore.getState().addJob(makeJob({ id: 'j1', status: 'running' }));
      expect(useJobStore.getState().activeJobIds.has('j1')).toBe(true);

      useJobStore.getState().updateJobStatus('j1', 'completed', {
        completedAt: '2026-04-01T01:00:00Z',
      });

      expect(useJobStore.getState().jobs.get('j1')?.status).toBe('completed');
      expect(useJobStore.getState().activeJobIds.has('j1')).toBe(false);
    });
  });

  describe('updateJobError', () => {
    it('sets string error and marks job as failed', () => {
      useJobStore.getState().addJob(makeJob({ id: 'j1', status: 'running' }));

      useJobStore.getState().updateJobError('j1', 'Something went wrong');

      const job = useJobStore.getState().jobs.get('j1');
      expect(job?.error).toBe('Something went wrong');
      expect(job?.status).toBe('failed');
    });

    it('sets JobError object and marks job as failed', () => {
      useJobStore.getState().addJob(makeJob({ id: 'j1', status: 'running' }));

      const jobError: JobError = {
        code: 'SCRAPE_FAILED',
        message: 'Connection timeout',
        details: 'Host unreachable',
      };
      useJobStore.getState().updateJobError('j1', jobError);

      const job = useJobStore.getState().jobs.get('j1');
      expect(job?.error).toEqual(jobError);
      expect(job?.status).toBe('failed');
    });
  });

  describe('getErrorMessage', () => {
    it('returns the string when error is a string', () => {
      expect(getErrorMessage('Something went wrong')).toBe('Something went wrong');
    });

    it('returns message from a JobError object', () => {
      const err: JobError = { code: 'SCRAPE_FAILED', message: 'Connection timeout' };
      expect(getErrorMessage(err)).toBe('Connection timeout');
    });

    it('returns "Unknown error" for null', () => {
      expect(getErrorMessage(null)).toBe('Unknown error');
    });

    it('returns "Unknown error" for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });
  });

  describe('removeJob', () => {
    it('calls API delete and removes job from store', async () => {
      mockApiDelete.mockResolvedValue(undefined);
      useJobStore.getState().addJob(makeJob({ id: 'j1' }));

      await useJobStore.getState().removeJob('j1');

      expect(mockApiDelete).toHaveBeenCalledWith('/api/v1/jobs/j1');
      expect(useJobStore.getState().jobs.has('j1')).toBe(false);
    });

    it('removes job from activeJobIds', async () => {
      mockApiDelete.mockResolvedValue(undefined);
      useJobStore.getState().addJob(makeJob({ id: 'j1', status: 'running' }));
      expect(useJobStore.getState().activeJobIds.has('j1')).toBe(true);

      await useJobStore.getState().removeJob('j1');

      expect(useJobStore.getState().activeJobIds.has('j1')).toBe(false);
    });
  });
});
