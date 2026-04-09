import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import uploadRoutes from './upload';

/**
 * Tests for Upload API routes — file upload, size limits, temp file creation
 */

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(uploadRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /upload', () => {
  it('accepts a file upload and returns file info', async () => {
    const boundary = '----testboundary';
    const fileContent = 'id,name\n1,Alice\n2,Bob';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.csv"',
      'Content-Type: text/csv',
      '',
      fileContent,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const data = res.json();
    expect(data.success).toBe(true);
    expect(data.data.originalName).toBe('test.csv');
    expect(data.data.filePath).toBeDefined();
    expect(data.data.size).toBeGreaterThan(0);

    // Clean up the temp file
    try {
      fs.unlinkSync(data.data.filePath);
    } catch {
      // ignore
    }
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----empty',
      },
      payload: '------empty--\r\n',
    });

    // Either 400 (no file) or some error status
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects path traversal with ../ in preview filePath', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/import/preview',
      query: { filePath: '../../../etc/passwd' },
    });

    // Should not leak file contents — either 403 or 404
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
  });

  it('rejects absolute path traversal in preview filePath', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/import/preview',
      query: { filePath: '/etc/passwd' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(403);
  });

  it('accepts normal filename in preview filePath', async () => {
    // First upload a file so we have a valid file in UPLOAD_DIR
    const boundary = '----testboundary3';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="preview-test.json"',
      'Content-Type: application/json',
      '',
      '[{"id": 1, "name": "Alice"}]',
      `--${boundary}--`,
    ].join('\r\n');

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(uploadRes.statusCode).toBe(201);
    const filePath = uploadRes.json().data.filePath;

    // Preview using the full path (basename is extracted server-side)
    const previewRes = await app.inject({
      method: 'GET',
      url: '/import/preview',
      query: { filePath },
    });

    expect(previewRes.statusCode).toBe(200);
    const previewData = previewRes.json();
    expect(previewData.success).toBe(true);
    expect(previewData.data.records).toHaveLength(1);
    expect(previewData.data.format).toBe('json');

    // Clean up
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  });

  it('creates temp file in the expected directory', async () => {
    const boundary = '----testboundary2';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="data.json"',
      'Content-Type: application/json',
      '',
      '{"test": true}',
      `--${boundary}--`,
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const filePath = res.json().data.filePath;
    const expectedDir = path.join(os.tmpdir(), 'dataset-builder-uploads');
    expect(filePath.startsWith(expectedDir)).toBe(true);

    // Verify file exists on disk
    expect(fs.existsSync(filePath)).toBe(true);

    // Clean up
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  });
});
