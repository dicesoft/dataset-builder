import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { saveJob, getJob, listJobs, deleteJob, setJobsDir } from './persistence';
import { JobRecord, JobStatus } from './types';

/**
 * T085: Unit tests for job persistence layer
 */

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: overrides.id ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    command: 'scrape',
    options: {},
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
    ...overrides,
  };
}

describe('job persistence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-persist-'));
    setJobsDir(tmpDir);
  });

  afterEach(async () => {
    setJobsDir(null);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // saveJob
  // -----------------------------------------------------------------------

  describe('saveJob', () => {
    it('writes a JSON file to disk', async () => {
      const job = makeJob({ id: 'save-test-1' });
      await saveJob(job);

      const filePath = path.join(tmpDir, 'save-test-1.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.id).toBe('save-test-1');
      expect(parsed.command).toBe('scrape');
      expect(parsed.status).toBe('queued');
    });

    it('overwrites existing file on re-save', async () => {
      const job = makeJob({ id: 'save-test-2' });
      await saveJob(job);

      job.status = JobStatus.running;
      await saveJob(job);

      const filePath = path.join(tmpDir, 'save-test-2.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.status).toBe('running');
    });

    it('creates the jobs directory if it does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'jobs');
      setJobsDir(nestedDir);

      const job = makeJob({ id: 'mkdir-test' });
      await saveJob(job);

      const filePath = path.join(nestedDir, 'mkdir-test.json');
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getJob
  // -----------------------------------------------------------------------

  describe('getJob', () => {
    it('reads and parses a JSON file', async () => {
      const job = makeJob({ id: 'get-test-1', command: 'generate' });
      await saveJob(job);

      const result = await getJob('get-test-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('get-test-1');
      expect(result!.command).toBe('generate');
    });

    it('returns null for non-existent job', async () => {
      const result = await getJob('does-not-exist');
      expect(result).toBeNull();
    });

    it('returns null for corrupted JSON file', async () => {
      const filePath = path.join(tmpDir, 'corrupted.json');
      await fs.writeFile(filePath, '{invalid json!!!', 'utf-8');

      const result = await getJob('corrupted');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // listJobs
  // -----------------------------------------------------------------------

  describe('listJobs', () => {
    it('returns all jobs', async () => {
      await saveJob(makeJob({ id: 'list-1', createdAt: '2026-01-01T00:00:00Z' }));
      await saveJob(makeJob({ id: 'list-2', createdAt: '2026-01-02T00:00:00Z' }));
      await saveJob(makeJob({ id: 'list-3', createdAt: '2026-01-03T00:00:00Z' }));

      const jobs = await listJobs();
      expect(jobs).toHaveLength(3);
    });

    it('returns jobs sorted by createdAt descending', async () => {
      await saveJob(makeJob({ id: 'sort-1', createdAt: '2026-01-01T00:00:00Z' }));
      await saveJob(makeJob({ id: 'sort-3', createdAt: '2026-01-03T00:00:00Z' }));
      await saveJob(makeJob({ id: 'sort-2', createdAt: '2026-01-02T00:00:00Z' }));

      const jobs = await listJobs();
      expect(jobs[0].id).toBe('sort-3');
      expect(jobs[1].id).toBe('sort-2');
      expect(jobs[2].id).toBe('sort-1');
    });

    it('filters by status', async () => {
      await saveJob(makeJob({ id: 'status-1', status: JobStatus.running }));
      await saveJob(makeJob({ id: 'status-2', status: JobStatus.completed }));
      await saveJob(makeJob({ id: 'status-3', status: JobStatus.running }));

      const running = await listJobs({ status: JobStatus.running });
      expect(running).toHaveLength(2);
      expect(running.every((j) => j.status === JobStatus.running)).toBe(true);
    });

    it('filters by command', async () => {
      await saveJob(makeJob({ id: 'cmd-1', command: 'scrape' }));
      await saveJob(makeJob({ id: 'cmd-2', command: 'generate' }));
      await saveJob(makeJob({ id: 'cmd-3', command: 'scrape' }));

      const scrapeJobs = await listJobs({ command: 'scrape' });
      expect(scrapeJobs).toHaveLength(2);
      expect(scrapeJobs.every((j) => j.command === 'scrape')).toBe(true);
    });

    it('filters by both status and command', async () => {
      await saveJob(makeJob({ id: 'both-1', command: 'scrape', status: JobStatus.running }));
      await saveJob(makeJob({ id: 'both-2', command: 'scrape', status: JobStatus.completed }));
      await saveJob(makeJob({ id: 'both-3', command: 'generate', status: JobStatus.running }));

      const jobs = await listJobs({ status: JobStatus.running, command: 'scrape' });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe('both-1');
    });

    it('returns empty array when directory does not exist', async () => {
      setJobsDir(path.join(tmpDir, 'nonexistent'));
      const jobs = await listJobs();
      expect(jobs).toEqual([]);
    });

    it('skips corrupted JSON files gracefully', async () => {
      await saveJob(makeJob({ id: 'valid-1' }));
      await fs.writeFile(path.join(tmpDir, 'corrupted.json'), 'not json!', 'utf-8');
      await saveJob(makeJob({ id: 'valid-2' }));

      const jobs = await listJobs();
      expect(jobs).toHaveLength(2);
    });

    it('ignores non-JSON files', async () => {
      await saveJob(makeJob({ id: 'json-1' }));
      await fs.writeFile(path.join(tmpDir, 'readme.txt'), 'hello', 'utf-8');

      const jobs = await listJobs();
      expect(jobs).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // deleteJob
  // -----------------------------------------------------------------------

  describe('deleteJob', () => {
    it('removes the file and returns true', async () => {
      await saveJob(makeJob({ id: 'del-1' }));
      const deleted = await deleteJob('del-1');
      expect(deleted).toBe(true);

      const filePath = path.join(tmpDir, 'del-1.json');
      await expect(fs.stat(filePath)).rejects.toThrow();
    });

    it('returns false when file does not exist', async () => {
      const deleted = await deleteJob('does-not-exist');
      expect(deleted).toBe(false);
    });
  });
});
