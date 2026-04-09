/**
 * T013: Job persistence layer
 * Read/write Job JSON files to configurable jobs directory
 */

import fs from 'fs/promises';
import path from 'path';
import { JobRecord, JobStatus } from './types';
import { getConfig } from '../../config';

let jobsDirOverride: string | null = null;

/**
 * Override the jobs directory (useful for testing)
 */
export function setJobsDir(dir: string | null): void {
  jobsDirOverride = dir;
}

/**
 * Get the jobs directory path from config
 */
export function getJobsDir(): string {
  if (jobsDirOverride) return jobsDirOverride;
  const config = getConfig();
  const outputDir = config.get('outputDir');
  return path.resolve(outputDir, 'jobs');
}

/**
 * Ensure the jobs directory exists
 */
async function ensureJobsDir(): Promise<string> {
  const dir = getJobsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Get the file path for a job record
 */
function jobFilePath(jobId: string): string {
  return path.join(getJobsDir(), `${jobId}.json`);
}

/**
 * Save a job record to disk
 */
export async function saveJob(job: JobRecord): Promise<void> {
  await ensureJobsDir();
  const filePath = jobFilePath(job.id);
  await fs.writeFile(filePath, JSON.stringify(job, null, 2), 'utf-8');
}

/**
 * Get a single job record by ID
 * Returns null if not found or corrupted
 */
export async function getJob(jobId: string): Promise<JobRecord | null> {
  const filePath = jobFilePath(jobId);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as JobRecord;
  } catch {
    return null;
  }
}

/**
 * List jobs with optional filtering by status and/or command
 */
export async function listJobs(filter?: {
  status?: JobStatus;
  command?: string;
}): Promise<JobRecord[]> {
  const dir = getJobsDir();
  const jobs: JobRecord[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Directory doesn't exist yet
    return [];
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const filePath = path.join(dir, entry);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const job = JSON.parse(content) as JobRecord;

      // Apply filters
      if (filter?.status && job.status !== filter.status) continue;
      if (filter?.command && job.command !== filter.command) continue;

      jobs.push(job);
    } catch (err) {
      // Corrupted JSON file - log warning and skip
      console.warn(`[persistence] Skipping corrupted job file: ${entry}`, err);
    }
  }

  // Sort by createdAt descending (newest first)
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return jobs;
}

/**
 * Delete a job record from disk
 * Returns true if deleted, false if not found
 */
export async function deleteJob(jobId: string): Promise<boolean> {
  const filePath = jobFilePath(jobId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
