/**
 * T015: Job manager
 * Job queue with configurable concurrency, auto-start, cancellation, and shutdown handling
 */

import { EventEmitter } from 'events';
import { statfs } from 'fs/promises';
import * as path from 'path';
import { JobRecord, JobStatus, CreateJobRequest, JobProgress, JobError } from './types';
import {
  saveJob,
  getJob,
  listJobs as persistenceListJobs,
  deleteJob as persistenceDeleteJob,
} from './persistence';
import { JobExecutor } from './executor';
import { checkDependenciesForCommand } from '../health/checker';
import { generateTaskId } from '../../utils/taskManager';
import { getConfig } from '../../config';

export interface JobManagerEvents {
  'job:progress': (jobId: string, progress: JobProgress) => void;
  'job:status': (jobId: string, record: JobRecord) => void;
  'job:error': (jobId: string, error: JobError) => void;
}

const MAX_JOBS = parseInt(process.env.MAX_JOBS || '3', 10);

/** Minimum free disk space threshold in bytes (default 500 MB) */
const DISK_SPACE_THRESHOLD_MB = parseInt(process.env.DISK_SPACE_THRESHOLD_MB || '500', 10);
const DISK_SPACE_THRESHOLD_BYTES = DISK_SPACE_THRESHOLD_MB * 1024 * 1024;

/** Commands that produce output and should check disk space */
const OUTPUT_COMMANDS = new Set([
  'scrape',
  'generate',
  'import',
  'transform',
  'format',
  'clean',
  'translate',
  'compress',
  'export',
  'download',
  'web-search',
  'run',
]);

/**
 * Check available disk space and return a warning if below threshold.
 * Returns null if space is sufficient or check fails silently.
 */
async function checkDiskSpace(): Promise<string | null> {
  try {
    const outputDir = path.resolve(getConfig().get('outputDir'));
    const stats = await statfs(outputDir);
    const freeBytes = stats.bfree * stats.bsize;
    const freeMB = Math.round(freeBytes / (1024 * 1024));

    if (freeBytes < DISK_SPACE_THRESHOLD_BYTES) {
      return `Low disk space warning: ${freeMB} MB free (threshold: ${DISK_SPACE_THRESHOLD_MB} MB). Job output may fail if disk fills up.`;
    }
    return null;
  } catch {
    // Silently ignore — disk check is best-effort
    return null;
  }
}

export class JobManager extends EventEmitter {
  private executors = new Map<string, JobExecutor>();
  private queue: string[] = [];
  private concurrencyLimit: number;
  private shuttingDown = false;

  constructor(concurrencyLimit?: number) {
    super();
    this.concurrencyLimit = concurrencyLimit ?? MAX_JOBS;
  }

  /**
   * Get the number of currently running jobs
   */
  get runningCount(): number {
    return this.executors.size;
  }

  /**
   * Get the number of queued jobs
   */
  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Create a new job and queue it for execution
   * Accepts either a CreateJobRequest object or (command, options) pair.
   * Returns the job record and optional warnings (e.g. low disk space).
   */
  async createJob(
    commandOrRequest: string | CreateJobRequest,
    optionsArg?: Record<string, unknown>
  ): Promise<JobRecord & { warnings?: string[] }> {
    const command =
      typeof commandOrRequest === 'string' ? commandOrRequest : commandOrRequest.command;
    const options =
      typeof commandOrRequest === 'string' ? optionsArg || {} : commandOrRequest.options;

    // Check dependencies before accepting the job (option-aware)
    const depCheck = await checkDependenciesForCommand(command, options);
    if (!depCheck.ok) {
      const missingNames = depCheck.missing.map((d) => d.name).join(', ');
      throw new Error(`Missing required dependencies for "${command}": ${missingNames}`);
    }

    // Pre-flight disk space check for output-producing commands
    const warnings: string[] = [];
    if (OUTPUT_COMMANDS.has(command)) {
      const diskWarning = await checkDiskSpace();
      if (diskWarning) {
        warnings.push(diskWarning);
      }
    }

    const job: JobRecord = {
      id: generateTaskId(),
      command,
      options,
      status: JobStatus.queued,
      progress: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      duration: null,
      outputPath: null,
      error: null,
      result: null,
      checkpointPath: null,
      logs: [],
    };

    await saveJob(job);
    this.queue.push(job.id);
    this.emit('job:status', job.id, job);

    // Try to start queued jobs
    await this.processQueue();

    // Attach warnings to the returned object (non-persisted metadata)
    if (warnings.length > 0) {
      return Object.assign(job, { warnings });
    }
    return job;
  }

  /**
   * Cancel a running or queued job
   */
  async cancelJob(jobId: string): Promise<JobRecord | null> {
    const job = await getJob(jobId);
    if (!job) return null;

    if (job.status === JobStatus.queued) {
      // Remove from queue
      this.queue = this.queue.filter((id) => id !== jobId);
      job.status = JobStatus.cancelled;
      job.completedAt = new Date().toISOString();
      await saveJob(job);
      this.emit('job:status', jobId, job);
      return job;
    }

    if (job.status === JobStatus.running) {
      const executor = this.executors.get(jobId);
      if (executor) {
        executor.cancel();
        this.executors.delete(jobId);
      }

      job.status = JobStatus.cancelled;
      job.completedAt = new Date().toISOString();
      if (job.startedAt) {
        job.duration = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      }
      await saveJob(job);
      this.emit('job:status', jobId, job);

      // Process queue to start next job
      await this.processQueue();
      return job;
    }

    // Job is in a terminal state, cannot cancel
    return job;
  }

  /**
   * Resume a failed or interrupted job.
   * If the job has a checkpointPath, it will be passed as --resume to the CLI.
   */
  async resumeJob(jobId: string): Promise<JobRecord | null> {
    const job = await getJob(jobId);
    if (!job) return null;

    if (job.status !== JobStatus.failed && job.status !== JobStatus.interrupted) {
      throw new Error(`Cannot resume job in "${job.status}" state`);
    }

    // If the job has a checkpoint, inject the resume flag into options
    if (job.checkpointPath) {
      // Commands like generate/clean/translate take --resume <path>
      // Transform takes --resume (boolean) — checkpoint is auto-detected
      if (job.command === 'transform') {
        job.options = { ...job.options, resume: true };
      } else {
        job.options = { ...job.options, resume: job.checkpointPath };
      }
    }

    // Re-queue the job
    job.status = JobStatus.queued;
    job.error = null;
    job.completedAt = null;
    job.duration = null;
    await saveJob(job);
    this.queue.push(job.id);
    this.emit('job:status', jobId, job);

    await this.processQueue();
    return job;
  }

  /**
   * Get a job record by ID
   */
  async getJob(jobId: string): Promise<JobRecord | null> {
    return getJob(jobId);
  }

  /**
   * List jobs with optional filtering
   */
  async listJobs(filter?: { status?: JobStatus; command?: string }): Promise<JobRecord[]> {
    return persistenceListJobs(filter);
  }

  /**
   * Delete a job record (only terminal states)
   */
  async deleteJob(jobId: string): Promise<boolean> {
    const job = await getJob(jobId);
    if (!job) return false;

    if (job.status === JobStatus.running || job.status === JobStatus.queued) {
      throw new Error(`Cannot delete job in "${job.status}" state. Cancel it first.`);
    }

    return persistenceDeleteJob(jobId);
  }

  /**
   * Process the queue: start jobs if slots are available
   */
  private async processQueue(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.executors.size < this.concurrencyLimit &&
      !this.shuttingDown
    ) {
      const jobId = this.queue.shift()!;
      await this.startJob(jobId);
    }
  }

  /**
   * Start executing a job
   */
  private async startJob(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) return;

    const executor = new JobExecutor();
    this.executors.set(jobId, executor);

    // Update job status to running
    job.status = JobStatus.running;
    job.startedAt = new Date().toISOString();
    await saveJob(job);
    this.emit('job:status', jobId, job);

    // Wire up executor events
    executor.on('progress', (progress: JobProgress) => {
      job.progress = progress;
      // Save progress periodically (debounced by persistence layer's async nature)
      saveJob(job).catch(() => {});
      this.emit('job:progress', jobId, progress);
    });

    executor.on('complete', async (result: unknown) => {
      this.executors.delete(jobId);

      job.status = JobStatus.completed;
      job.completedAt = new Date().toISOString();
      job.result = result;

      // Extract outputPath from result envelope and normalize to be relative to outputDir.
      // The CLI emits paths that may include the "output/" prefix (relative to CWD) or be
      // absolute. We strip the prefix so the datasets API can resolve them correctly.
      if (result && typeof result === 'object') {
        const res = result as Record<string, unknown>;
        const raw =
          typeof res.outputFile === 'string'
            ? res.outputFile
            : typeof res.outputDir === 'string'
              ? res.outputDir
              : null;
        if (raw) {
          try {
            const outputDir = path.resolve(getConfig().get('outputDir') as string);
            const absolute = path.resolve(raw);
            const rel = path.relative(outputDir, absolute).replace(/\\/g, '/');
            // If the path is inside outputDir, store the relative form. Otherwise keep raw.
            job.outputPath = rel && !rel.startsWith('..') ? rel : raw.replace(/\\/g, '/');
          } catch {
            job.outputPath = raw.replace(/\\/g, '/');
          }
        }
      }

      if (job.startedAt) {
        job.duration = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      }
      await saveJob(job);
      this.emit('job:status', jobId, job);

      // Process queue for next job
      await this.processQueue();
    });

    executor.on('log', (line: string) => {
      job.logs.push(line);
      this.emit('job:log', jobId, line);
    });

    executor.on('error', async (error: JobError) => {
      this.executors.delete(jobId);

      job.status = JobStatus.failed;
      job.completedAt = new Date().toISOString();
      job.error = error;
      if (job.startedAt) {
        job.duration = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      }
      await saveJob(job);
      this.emit('job:error', jobId, error);
      this.emit('job:status', jobId, job);

      // Process queue for next job
      await this.processQueue();
    });

    // Start the process (don't await - it runs in background)
    executor.run(job.command, job.options).catch(async (err) => {
      this.executors.delete(jobId);
      const error: JobError = {
        code: 'EXECUTOR_ERROR',
        message: err instanceof Error ? err.message : String(err),
        details: null,
      };
      job.status = JobStatus.failed;
      job.completedAt = new Date().toISOString();
      job.error = error;
      await saveJob(job);
      this.emit('job:error', jobId, error);
      this.emit('job:status', jobId, job);
    });
  }

  /**
   * Mark all running jobs as interrupted (called during shutdown)
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    // Kill all running processes
    for (const [jobId, executor] of this.executors) {
      executor.cancel();

      const job = await getJob(jobId);
      if (job) {
        job.status = JobStatus.interrupted;
        job.completedAt = new Date().toISOString();
        if (job.startedAt) {
          job.duration = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
        }
        await saveJob(job);
        this.emit('job:status', jobId, job);
      }
    }

    this.executors.clear();

    // Mark queued jobs as interrupted too
    for (const jobId of this.queue) {
      const job = await getJob(jobId);
      if (job) {
        job.status = JobStatus.interrupted;
        await saveJob(job);
      }
    }
    this.queue = [];
  }

  /**
   * T078: Recover interrupted jobs on server startup.
   * Scans persisted jobs for status=running or status=queued (stale from
   * unclean shutdown) and marks them as interrupted so they appear with a
   * resume option in the UI.
   */
  async recoverInterruptedJobs(): Promise<number> {
    const runningJobs = await persistenceListJobs({ status: JobStatus.running });
    const queuedJobs = await persistenceListJobs({ status: JobStatus.queued });
    const staleJobs = [...runningJobs, ...queuedJobs];

    for (const job of staleJobs) {
      job.status = JobStatus.interrupted;
      job.completedAt = job.completedAt ?? new Date().toISOString();
      if (job.startedAt && !job.duration) {
        job.duration = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      }
      await saveJob(job);
      this.emit('job:status', job.id, job);
    }

    return staleJobs.length;
  }
}

// Singleton instance
let managerInstance: JobManager | null = null;

export function getJobManager(): JobManager {
  if (!managerInstance) {
    managerInstance = new JobManager();
  }
  return managerInstance;
}
