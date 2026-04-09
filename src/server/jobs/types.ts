/**
 * T012: Job types and interfaces for the web dashboard server
 */

export enum JobStatus {
  queued = 'queued',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
  cancelled = 'cancelled',
  interrupted = 'interrupted',
}

export interface JobProgress {
  phase: string;
  current: number;
  total: number | null;
  counters: Record<string, number> | null;
  message: string | null;
  throughput: number | null;
}

export interface JobErrorDetails {
  exitCode: number | null;
  signal?: string;
  stderr?: string;
}

export interface JobError {
  code: string;
  message: string;
  details: JobErrorDetails | Record<string, unknown> | null;
}

export interface JobRecord {
  id: string;
  command: string;
  options: Record<string, unknown>;
  status: JobStatus;
  progress: JobProgress | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  outputPath: string | null;
  error: JobError | null;
  result: unknown;
  checkpointPath: string | null;
  logs: string[];
}

export interface CreateJobRequest {
  command: string;
  options: Record<string, unknown>;
}
