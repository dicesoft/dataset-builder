import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import datasetsRoutes from './datasets';

/**
 * Tests for Datasets API routes — listing, records, media serving, path traversal
 */

// Mock the config module
vi.mock('../../config', () => {
  let outputDir = '';
  return {
    getConfig: () => ({
      get: (key: string) => {
        if (key === 'outputDir') return outputDir;
        return '';
      },
    }),
    __setOutputDir: (dir: string) => {
      outputDir = dir;
    },
  };
});

import { __setOutputDir } from '../../config';

let app: FastifyInstance;
let testDir: string;

beforeAll(async () => {
  // Create a temp directory with test data files
  testDir = path.join(os.tmpdir(), `dataset-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  // Create a JSON dataset
  fs.writeFileSync(
    path.join(testDir, 'data.json'),
    JSON.stringify([
      { id: 1, name: 'Alice', score: 95 },
      { id: 2, name: 'Bob', score: 87 },
      { id: 3, name: 'Charlie', score: 72 },
    ])
  );

  // Create a JSONL dataset
  fs.writeFileSync(
    path.join(testDir, 'data.jsonl'),
    '{"id":1,"text":"hello"}\n{"id":2,"text":"world"}\n{"id":3,"text":"foo"}\n'
  );

  // Create a CSV dataset
  fs.writeFileSync(path.join(testDir, 'data.csv'), 'name,age,city\nAlice,30,NYC\nBob,25,LA\n');

  // Create a media file
  fs.writeFileSync(path.join(testDir, 'image.png'), Buffer.from('fakepng'));
});

afterAll(async () => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

beforeEach(async () => {
  (__setOutputDir as any)(testDir);
  app = Fastify({ logger: false });
  await app.register(datasetsRoutes, { outputDir: testDir });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /datasets', () => {
  it('lists all datasets in the output directory', async () => {
    const res = await app.inject({ method: 'GET', url: '/datasets' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.datasets.length).toBeGreaterThanOrEqual(3);

    const names = body.data.datasets.map((d: any) => d.name);
    expect(names).toContain('data.json');
    expect(names).toContain('data.jsonl');
    expect(names).toContain('data.csv');
  });

  it('returns dataset metadata (type, size, recordCount, fields)', async () => {
    const res = await app.inject({ method: 'GET', url: '/datasets' });
    const body = res.json();

    const jsonDataset = body.data.datasets.find((d: any) => d.name === 'data.json');
    expect(jsonDataset).toBeDefined();
    expect(jsonDataset.type).toBe('json');
    expect(jsonDataset.recordCount).toBe(3);
    expect(jsonDataset.fields).toContain('id');
    expect(jsonDataset.fields).toContain('name');
    expect(jsonDataset.size).toBeGreaterThan(0);
  });

  it('returns empty datasets array when output dir does not exist', async () => {
    const emptyApp = Fastify({ logger: false });
    await emptyApp.register(datasetsRoutes, { outputDir: '/nonexistent/path' });
    await emptyApp.ready();

    const res = await emptyApp.inject({ method: 'GET', url: '/datasets' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.datasets).toEqual([]);

    await emptyApp.close();
  });
});

describe('GET /datasets — exclusion filters', () => {
  it('excludes files inside the jobs/ subdirectory at top level', async () => {
    // Create jobs/ directory with a job file
    const jobsDir = path.join(testDir, 'jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, 'job-abc123.json'),
      JSON.stringify({ id: 'abc123', status: 'completed' })
    );

    const res = await app.inject({ method: 'GET', url: '/datasets' });
    const body = res.json();
    const names = body.data.datasets.map((d: any) => d.name);

    expect(names).not.toContain('job-abc123.json');

    // Clean up
    fs.rmSync(jobsDir, { recursive: true, force: true });
  });

  it('excludes internal filenames (metadata.json, downloads_manifest.json, etc.)', async () => {
    // Create a task subdirectory with internal files
    const taskDir = path.join(testDir, 'scrape-task-1');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'metadata.json'), JSON.stringify({ task: 'test' }));
    fs.writeFileSync(path.join(taskDir, 'downloads_manifest.json'), JSON.stringify({ files: [] }));
    fs.writeFileSync(path.join(taskDir, 'operations.jsonl'), '{"op":"test"}\n');
    fs.writeFileSync(path.join(taskDir, 'errors.jsonl'), '{"error":"test"}\n');
    // Also add a real dataset file that should NOT be excluded
    fs.writeFileSync(
      path.join(taskDir, 'results.json'),
      JSON.stringify([{ id: 1, text: 'real data' }])
    );

    const res = await app.inject({ method: 'GET', url: '/datasets' });
    const body = res.json();
    const names = body.data.datasets.map((d: any) => d.name);

    expect(names).not.toContain('metadata.json');
    expect(names).not.toContain('downloads_manifest.json');
    expect(names).not.toContain('operations.jsonl');
    expect(names).not.toContain('errors.jsonl');
    expect(names).toContain('results.json');

    // Clean up
    fs.rmSync(taskDir, { recursive: true, force: true });
  });

  it('does NOT exclude a directory named "jobs" nested inside a subdirectory', async () => {
    // Create nested jobs directory — should NOT be excluded (only top-level is excluded)
    const nestedDir = path.join(testDir, 'project', 'jobs');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'nested-data.json'), JSON.stringify([{ id: 1 }]));

    const res = await app.inject({ method: 'GET', url: '/datasets' });
    const body = res.json();
    const names = body.data.datasets.map((d: any) => d.name);

    expect(names).toContain('nested-data.json');

    // Clean up
    fs.rmSync(path.join(testDir, 'project'), { recursive: true, force: true });
  });
});

describe('GET /datasets/:path/records', () => {
  it('returns paginated records from a JSON file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json')}/records?page=1&pageSize=2`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.records).toHaveLength(2);
    expect(body.data.total).toBe(3);
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(2);
  });

  it('returns records from a JSONL file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.jsonl')}/records`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.records.length).toBeGreaterThanOrEqual(1);
    expect(body.data.total).toBe(3);
  });

  it('returns records from a CSV file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.csv')}/records`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.records.length).toBe(2);
    expect(body.data.records[0]).toHaveProperty('name');
  });

  it('returns 404 for non-existent dataset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('nonexistent.json')}/records`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('prevents path traversal attacks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('../../etc/passwd')}/records`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe('Path traversal hardening', () => {
  it('blocks ../../ traversal in records endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('../../etc/passwd')}/records`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('blocks ../.. traversal in fields endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('../../etc/shadow')}/fields`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('blocks double-encoded traversal (%252e%252e)', async () => {
    // %252e is double-encoded '.' — after one decode it becomes %2e, which becomes '.'
    // The server decodes once with decodeURIComponent, so we test with a traversal
    // that after full decode would escape the output dir
    const doubleEncoded = encodeURIComponent('..%2f..%2fetc%2fpasswd');
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${doubleEncoded}/records`,
    });
    // Should be blocked (403) or not found (404) — never 200
    expect([403, 404]).toContain(res.statusCode);
  });

  it('blocks null byte injection', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json\0.txt')}/records`,
    });
    // Null bytes should not bypass path checks — expect 403, 404, or 500
    expect([403, 404, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      throw new Error('Null byte injection should not return 200');
    }
  });

  it('blocks traversal in single record endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('../../../etc/passwd')}/records/0`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('blocks traversal in media endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/media/${encodeURIComponent('../../etc/passwd')}`,
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it('blocks backslash traversal on Windows-style paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('..\\..\\etc\\passwd')}/records`,
    });
    // path.resolve handles backslashes — should be blocked or not found
    expect([403, 404]).toContain(res.statusCode);
  });

  it('returns downloads_manifest.json entries for the dataset', async () => {
    // Create a task subdirectory with a downloads manifest
    const taskDir = path.join(testDir, 'task_manifest_test');
    const downloadsDir = path.join(taskDir, 'downloads');
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, 'scraped_combined.json'),
      JSON.stringify([{ id: 1, files: ['https://example.com/img.jpg'] }])
    );
    fs.writeFileSync(
      path.join(downloadsDir, 'downloads_manifest.json'),
      JSON.stringify({
        taskId: 'task_manifest_test',
        assets: [
          {
            id: 'asset_0',
            sourceUrl: 'https://example.com/img.jpg',
            localPath: 'downloads/images/img.jpg',
            status: 'completed',
          },
          {
            id: 'asset_1',
            sourceUrl: 'https://example.com/skipped.jpg',
            localPath: 'downloads/images/skipped.jpg',
            status: 'failed',
          },
        ],
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('task_manifest_test/scraped_combined.json')}/manifest`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.sourceUrls).toHaveLength(1);
    expect(body.data.sourceUrls[0].sourceUrl).toBe('https://example.com/img.jpg');
    expect(body.data.sourceUrls[0].localPath).toBe('task_manifest_test/downloads/images/img.jpg');
  });

  it('returns null manifest when no downloads_manifest.json exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json')}/manifest`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.manifest).toBeNull();
    expect(res.json().data.sourceUrls).toEqual([]);
  });

  it('strips a stray outputDir basename prefix from the dataset path (legacy job records)', async () => {
    // Old job records may have stored paths like "<outputDirBase>/data.json" relative to CWD,
    // not relative to outputDir. The API should strip the leading basename segment.
    const outputDirBase = path.basename(testDir);
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent(`${outputDirBase}/data.json`)}/records`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.records.length).toBeGreaterThan(0);
  });

  it('normalizes backslashes to forward slashes for valid dataset paths', async () => {
    // Create a subdirectory dataset to simulate Windows-style path from job result
    const subDir = path.join(testDir, 'task_123');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'result.json'), JSON.stringify([{ id: 1, name: 'test' }]));

    // Request with backslashes (as Windows job.outputPath would produce)
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('task_123\\result.json')}/records`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.records).toHaveLength(1);
    expect(res.json().data.records[0].name).toBe('test');
  });
});

describe('GET /datasets/:path/records/:index', () => {
  it('returns a single record by index', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json')}/records/1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.record.name).toBe('Bob');
    expect(body.data.index).toBe(1);
  });

  it('returns 404 for out-of-range index', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json')}/records/999`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for negative index', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json')}/records/-1`,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /datasets/:path/fields', () => {
  it('returns field names from a JSON dataset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.json')}/fields`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.command).toBe('datasets.fields');
    expect(body.data.fields).toEqual(['id', 'name', 'score']);
  });

  it('returns field names from a JSONL dataset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.jsonl')}/fields`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.fields).toEqual(['id', 'text']);
  });

  it('returns field names from a CSV dataset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('data.csv')}/fields`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.fields).toEqual(['name', 'age', 'city']);
  });

  it('returns 404 for non-existent dataset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('nonexistent.json')}/fields`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('prevents path traversal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('../../etc/passwd')}/fields`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('returns 400 for unsupported file type', async () => {
    // Create a .txt file in the test dir
    fs.writeFileSync(path.join(testDir, 'readme.txt'), 'hello');

    const res = await app.inject({
      method: 'GET',
      url: `/datasets/${encodeURIComponent('readme.txt')}/fields`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNSUPPORTED_TYPE');
  });
});

describe('GET /media/*', () => {
  it('serves a media file with correct content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/media/image.png',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('returns 404 for non-existent media file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/media/nonexistent.jpg',
    });

    expect(res.statusCode).toBe(404);
  });

  it('prevents path traversal in media paths', async () => {
    // Fastify normalizes /../ in URLs, so use encoded traversal
    const res = await app.inject({
      method: 'GET',
      url: `/media/${encodeURIComponent('../../etc/passwd')}`,
    });

    // Should be 403 (traversal blocked) or 404 (file not found) — never 200
    expect([403, 404]).toContain(res.statusCode);
    if (res.statusCode === 403) {
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
  });
});

describe('scanDataFiles edge cases', () => {
  it('handles empty output directory without crashing', async () => {
    const emptyDir = path.join(os.tmpdir(), `dataset-empty-${Date.now()}`);
    fs.mkdirSync(emptyDir, { recursive: true });

    const emptyApp = Fastify({ logger: false });
    await emptyApp.register(datasetsRoutes, { outputDir: emptyDir });
    await emptyApp.ready();

    const res = await emptyApp.inject({ method: 'GET', url: '/datasets' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.datasets).toEqual([]);

    await emptyApp.close();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('handles non-existent output directory gracefully', async () => {
    const missingDir = path.join(os.tmpdir(), `dataset-missing-${Date.now()}`);

    const missingApp = Fastify({ logger: false });
    await missingApp.register(datasetsRoutes, { outputDir: missingDir });
    await missingApp.ready();

    const res = await missingApp.inject({ method: 'GET', url: '/datasets' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.datasets).toEqual([]);

    await missingApp.close();
  });

  it('skips unreadable subdirectories without crashing', async () => {
    const permDir = path.join(os.tmpdir(), `dataset-perm-${Date.now()}`);
    fs.mkdirSync(permDir, { recursive: true });
    fs.writeFileSync(path.join(permDir, 'visible.json'), JSON.stringify([{ id: 1 }]));

    // Create a subdirectory — on Windows we can't reliably remove read permissions,
    // so just verify the scan completes with the visible file
    const subDir = path.join(permDir, 'restricted');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'hidden.json'), JSON.stringify([{ id: 2 }]));

    const permApp = Fastify({ logger: false });
    await permApp.register(datasetsRoutes, { outputDir: permDir });
    await permApp.ready();

    const res = await permApp.inject({ method: 'GET', url: '/datasets' });
    expect(res.statusCode).toBe(200);
    // Should have at least the visible file
    const names = res.json().data.datasets.map((d: any) => d.name);
    expect(names).toContain('visible.json');

    await permApp.close();
    fs.rmSync(permDir, { recursive: true, force: true });
  });

  it('skips symlinks pointing outside output directory', async () => {
    // Symlink creation may require elevated privileges on Windows;
    // skip gracefully if not available
    const symlinkDir = path.join(os.tmpdir(), `dataset-symlink-${Date.now()}`);
    fs.mkdirSync(symlinkDir, { recursive: true });
    fs.writeFileSync(path.join(symlinkDir, 'real.json'), JSON.stringify([{ id: 1 }]));

    const outsideDir = path.join(os.tmpdir(), `dataset-outside-${Date.now()}`);
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'secret.json'), JSON.stringify([{ id: 99 }]));

    try {
      fs.symlinkSync(outsideDir, path.join(symlinkDir, 'linked'), 'junction');
    } catch {
      // Symlinks may not be available — skip test
      fs.rmSync(symlinkDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }

    const symlinkApp = Fastify({ logger: false });
    await symlinkApp.register(datasetsRoutes, { outputDir: symlinkDir });
    await symlinkApp.ready();

    const res = await symlinkApp.inject({ method: 'GET', url: '/datasets' });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.datasets.map((d: any) => d.name);

    // real.json should be listed, but secret.json from outside dir should not
    expect(names).toContain('real.json');
    expect(names).not.toContain('secret.json');

    await symlinkApp.close();
    fs.rmSync(symlinkDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
