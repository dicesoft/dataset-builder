import { create } from 'zustand';
import { apiGet, apiPost, apiDelete } from '../utils/api';

export interface JobProgress {
  phase: string;
  current: number;
  total: number;
  counters: Record<string, number>;
  message: string;
  throughput: number;
}

export interface JobErrorDetails {
  exitCode: number | null;
  signal?: string;
  stderr?: string;
}

export interface JobError {
  code: string;
  message: string;
  details?: JobErrorDetails | Record<string, unknown> | string | null;
}

export interface JobRecord {
  id: string;
  command: string;
  status: string;
  progress: JobProgress | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  outputPath: string | null;
  error: JobError | string | null;
  options?: Record<string, unknown>;
  result?: Record<string, unknown>;
  logs?: string[];
}

/** Safely extract a display string from a JobError object, string, or null. */
export function getErrorMessage(error: JobError | string | null | undefined): string {
  if (error == null) return 'Unknown error';
  if (typeof error === 'string') return error;
  return error.message;
}

interface JobState {
  jobs: Map<string, JobRecord>;
  activeJobIds: Set<string>;
}

interface JobActions {
  fetchJobs: () => Promise<void>;
  addJob: (job: JobRecord) => void;
  updateJobProgress: (jobId: string, progress: JobProgress) => void;
  updateJobStatus: (jobId: string, status: string, updates?: Partial<JobRecord>) => void;
  updateJobError: (jobId: string, error: JobError | string) => void;
  appendJobLog: (jobId: string, line: string) => void;
  removeJob: (jobId: string) => Promise<void>;
}

const ACTIVE_STATUSES = new Set(['pending', 'running', 'queued']);

function deriveActiveIds(jobs: Map<string, JobRecord>): Set<string> {
  const active = new Set<string>();
  for (const [id, job] of jobs) {
    if (ACTIVE_STATUSES.has(job.status)) {
      active.add(id);
    }
  }
  return active;
}

export const useJobStore = create<JobState & JobActions>()((set) => ({
  jobs: new Map(),
  activeJobIds: new Set(),

  fetchJobs: async () => {
    const data = await apiGet<{ jobs: JobRecord[]; total: number }>('/api/v1/jobs');
    const jobs = new Map(data.jobs.map((j) => [j.id, j]));
    set({ jobs, activeJobIds: deriveActiveIds(jobs) });
  },

  addJob: (job) =>
    set((state) => {
      const jobs = new Map(state.jobs);
      jobs.set(job.id, job);
      return { jobs, activeJobIds: deriveActiveIds(jobs) };
    }),

  updateJobProgress: (jobId, progress) =>
    set((state) => {
      const existing = state.jobs.get(jobId);
      if (!existing) return state;
      const jobs = new Map(state.jobs);
      jobs.set(jobId, { ...existing, progress });
      return { jobs };
    }),

  updateJobStatus: (jobId, status, updates) =>
    set((state) => {
      const existing = state.jobs.get(jobId);
      if (!existing) return state;
      const jobs = new Map(state.jobs);
      jobs.set(jobId, { ...existing, ...updates, status });
      return { jobs, activeJobIds: deriveActiveIds(jobs) };
    }),

  updateJobError: (jobId, error) =>
    set((state) => {
      const existing = state.jobs.get(jobId);
      if (!existing) return state;
      const jobs = new Map(state.jobs);
      jobs.set(jobId, { ...existing, error, status: 'failed' });
      return { jobs, activeJobIds: deriveActiveIds(jobs) };
    }),

  appendJobLog: (jobId, line) =>
    set((state) => {
      const existing = state.jobs.get(jobId);
      if (!existing) return state;
      const jobs = new Map(state.jobs);
      const logs = [...(existing.logs ?? []), line];
      jobs.set(jobId, { ...existing, logs });
      return { jobs };
    }),

  removeJob: async (jobId) => {
    await apiDelete(`/api/v1/jobs/${jobId}`);
    set((state) => {
      const jobs = new Map(state.jobs);
      jobs.delete(jobId);
      const activeJobIds = new Set(state.activeJobIds);
      activeJobIds.delete(jobId);
      return { jobs, activeJobIds };
    });
  },
}));
