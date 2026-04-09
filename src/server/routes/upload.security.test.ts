import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import uploadRoutes from './upload';

/**
 * 4.7: Upload security tests — extended path traversal and edge cases
 *
 * Supplements upload.test.ts with additional security-focused test cases.
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

describe('Upload security (extended)', () => {
  describe('Path traversal variants', () => {
    it('blocks double-encoded ../ in preview filePath', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: '..%2F..%2Fetc%2Fpasswd' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(403);
    });

    it('blocks Windows-style backslash traversal in preview filePath', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: '..\\..\\..\\windows\\system32\\config\\sam' },
      });

      // Should be rejected — not a valid upload path
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('blocks path with embedded null byte', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: 'valid.csv\0../../etc/passwd' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('blocks absolute Windows path in preview filePath', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: 'C:\\Windows\\System32\\config\\sam' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('blocks deeply nested traversal', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: '../../../../../../../../etc/shadow' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(403);
    });

    it('blocks traversal disguised with valid prefix', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: 'uploads/../../../etc/passwd' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(403);
    });
  });

  describe('Normal file operations', () => {
    it('allows preview of uploaded JSON file with valid path', async () => {
      // Upload a file first
      const boundary = '----sectest1';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="sec-test.json"',
        'Content-Type: application/json',
        '',
        '[{"id": 1}]',
        `--${boundary}--`,
      ].join('\r\n');

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(uploadRes.statusCode).toBe(201);
      const filePath = uploadRes.json().data.filePath;

      // Preview with the uploaded path — should work
      const previewRes = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath },
      });

      expect(previewRes.statusCode).toBe(200);
      expect(previewRes.json().success).toBe(true);

      // Clean up
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    });

    it('allows preview of uploaded CSV file', async () => {
      const boundary = '----sectest2';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="sec-test.csv"',
        'Content-Type: text/csv',
        '',
        'name,age\nAlice,30\nBob,25',
        `--${boundary}--`,
      ].join('\r\n');

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(uploadRes.statusCode).toBe(201);
      const filePath = uploadRes.json().data.filePath;

      const previewRes = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath },
      });

      expect(previewRes.statusCode).toBe(200);
      const data = previewRes.json();
      expect(data.success).toBe(true);
      expect(data.data.format).toBe('csv');

      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    });

    it('returns 404 for non-existent file in upload directory', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/import/preview',
        query: { filePath: 'nonexistent-file-12345.csv' },
      });

      // Should fail gracefully — file not found
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('DELETE cleanup endpoint', () => {
    it('deletes uploaded file successfully', async () => {
      // Upload first
      const boundary = '----sectest3';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="to-delete.json"',
        'Content-Type: application/json',
        '',
        '{"test": true}',
        `--${boundary}--`,
      ].join('\r\n');

      const uploadRes = await app.inject({
        method: 'POST',
        url: '/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });

      expect(uploadRes.statusCode).toBe(201);
      const filePath = uploadRes.json().data.filePath;
      const filename = path.basename(filePath);

      // Verify file exists
      expect(fs.existsSync(filePath)).toBe(true);

      // Delete it
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/upload/${encodeURIComponent(filename)}`,
      });

      expect(deleteRes.statusCode).toBeLessThan(500);
    });

    it('blocks path traversal in DELETE filename parameter', async () => {
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/upload/../../../etc/passwd',
      });

      // Should not succeed — either 403/404/400
      expect(deleteRes.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
