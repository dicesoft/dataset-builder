/**
 * T065: File upload route
 * POST /upload — Accept multipart file upload, save to temp directory
 */

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { ok, fail } from '../utils/envelope';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPLOAD_DIR = join(tmpdir(), 'dataset-builder-uploads');
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Preview helpers
// ---------------------------------------------------------------------------

const PREVIEW_LIMIT = 10;

/** Detect file format from extension */
function detectFormat(filePath: string): 'json' | 'jsonl' | 'csv' | 'xml' | 'excel' | 'unknown' {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.xml') return 'xml';
  if (ext === '.xlsx' || ext === '.xls') return 'excel';
  return 'unknown';
}

/** Parse CSV content into record objects */
function parseCsvContent(content: string): Record<string, unknown>[] {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const records: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const record: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? '';
    }
    records.push(record);
  }

  return records;
}

/** Read first N lines from a JSONL file */
async function readJsonlPreview(
  filePath: string,
  limit: number
): Promise<{ records: Record<string, unknown>[]; totalEstimate: number }> {
  return new Promise((resolve, reject) => {
    const records: Record<string, unknown>[] = [];
    let total = 0;

    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      total++;
      if (records.length < limit) {
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          /* skip malformed */
        }
      }
    });

    rl.on('close', () => resolve({ records, totalEstimate: total }));
    rl.on('error', reject);
  });
}

/** Stream-read first N lines from a CSV file to avoid OOM on large files */
async function readCsvPreview(
  filePath: string,
  limit: number
): Promise<{ records: Record<string, unknown>[]; fields: string[]; totalEstimate: number }> {
  return new Promise((resolvePromise, reject) => {
    const lines: string[] = [];
    // Read header + limit data lines + extra lines for total estimate
    const maxLines = limit + 1; // header + data lines
    let lineCount = 0;

    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      lineCount++;
      if (lines.length < maxLines) {
        lines.push(trimmed);
      }
    });

    rl.on('close', () => {
      const content = lines.join('\n');
      const records = parseCsvContent(content);
      const fields = records.length > 0 ? Object.keys(records[0]) : [];
      // lineCount includes header, so total data rows = lineCount - 1
      resolvePromise({
        records: records.slice(0, limit),
        fields,
        totalEstimate: Math.max(0, lineCount - 1),
      });
    });

    rl.on('error', reject);
  });
}

/** Stream-read first N records from a JSON array file to avoid OOM on large files */
async function readJsonPreview(
  filePath: string,
  limit: number
): Promise<{ records: Record<string, unknown>[]; totalEstimate: number }> {
  const MAX_PREVIEW_BYTES = 64 * 1024; // 64KB
  const fileStats = await stat(filePath);

  // For small files, just read the whole thing
  if (fileStats.size <= MAX_PREVIEW_BYTES) {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const allRecords = Array.isArray(parsed) ? parsed : [parsed];
    return { records: allRecords.slice(0, limit), totalEstimate: allRecords.length };
  }

  // For large files, read only the first chunk
  const buffer = Buffer.alloc(MAX_PREVIEW_BYTES);
  const fd = await import('node:fs/promises').then((m) => m.open(filePath, 'r'));
  try {
    await fd.read(buffer, 0, MAX_PREVIEW_BYTES, 0);
  } finally {
    await fd.close();
  }

  const chunk = buffer.toString('utf-8');
  const records: Record<string, unknown>[] = [];

  // Try to extract individual JSON objects from the array
  // Find the opening bracket
  const startIdx = chunk.indexOf('[');
  if (startIdx === -1) {
    // Not an array, try parsing as single object
    try {
      const parsed = JSON.parse(chunk);
      return { records: [parsed], totalEstimate: 1 };
    } catch {
      return { records: [], totalEstimate: 0 };
    }
  }

  // Extract objects by tracking brace depth
  let depth = 0;
  let objStart = -1;
  for (let i = startIdx + 1; i < chunk.length && records.length < limit; i++) {
    const ch = chunk[i];
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          records.push(JSON.parse(chunk.slice(objStart, i + 1)));
        } catch {
          /* skip malformed */
        }
        objStart = -1;
      }
    }
  }

  // Estimate total from file size ratio
  const bytesUsed = chunk.lastIndexOf('}') + 1 - startIdx;
  const avgRecordSize = records.length > 0 ? bytesUsed / records.length : 1;
  const totalEstimate = records.length > 0 ? Math.round(fileStats.size / avgRecordSize) : 0;

  return { records, totalEstimate };
}

const uploadRoutes: FastifyPluginCallback = (fastify: FastifyInstance, _opts, done) => {
  // Register multipart support
  fastify.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  // -----------------------------------------------------------------------
  // POST /upload — accept a single file upload
  // -----------------------------------------------------------------------
  fastify.post('/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await request.file();

      if (!data) {
        return fail('upload', 'NO_FILE', 'No file was uploaded', reply, 400);
      }

      // Ensure upload directory exists
      await mkdir(UPLOAD_DIR, { recursive: true });

      // Generate unique filename to avoid collisions
      const ext = data.filename.includes('.') ? '.' + data.filename.split('.').pop() : '';
      const uniqueName = `${randomUUID()}${ext}`;
      const filePath = join(UPLOAD_DIR, uniqueName);

      // Stream file to disk
      const writeStream = createWriteStream(filePath);
      await pipeline(data.file, writeStream);

      // Check if file was truncated (exceeded size limit)
      if (data.file.truncated) {
        return fail(
          'upload',
          'FILE_TOO_LARGE',
          `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          reply,
          413
        );
      }

      return ok(
        'upload',
        {
          filePath,
          originalName: data.filename,
          mimetype: data.mimetype,
          size: writeStream.bytesWritten,
        },
        reply,
        201
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('upload', 'UPLOAD_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /import/preview — preview first records of an uploaded file
  // -----------------------------------------------------------------------
  fastify.get('/import/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filePath } = request.query as { filePath?: string };

    if (!filePath) {
      return fail(
        'import.preview',
        'MISSING_PARAM',
        'filePath query parameter is required',
        reply,
        400
      );
    }

    // Security: only allow files within the upload temp directory
    const resolved = resolve(UPLOAD_DIR, basename(filePath));
    if (!resolved.startsWith(UPLOAD_DIR)) {
      return fail(
        'import.preview',
        'INVALID_PATH',
        'File path is not within the upload directory',
        reply,
        403
      );
    }

    try {
      await stat(resolved);
    } catch {
      return fail('import.preview', 'FILE_NOT_FOUND', 'Uploaded file not found', reply, 404);
    }

    try {
      const format = detectFormat(resolved);
      let records: Record<string, unknown>[] = [];
      let totalEstimate = 0;

      let fields: string[] = [];

      if (format === 'json') {
        const result = await readJsonPreview(resolved, PREVIEW_LIMIT);
        records = result.records;
        totalEstimate = result.totalEstimate;
      } else if (format === 'jsonl') {
        const result = await readJsonlPreview(resolved, PREVIEW_LIMIT);
        records = result.records;
        totalEstimate = result.totalEstimate;
      } else if (format === 'csv') {
        const result = await readCsvPreview(resolved, PREVIEW_LIMIT);
        records = result.records;
        fields = result.fields;
        totalEstimate = result.totalEstimate;
      } else if (format === 'xml') {
        // XML preview is best-effort — return empty with format hint
        records = [];
        totalEstimate = 0;
      } else if (format === 'excel') {
        return ok(
          'import.preview',
          {
            records: [],
            fields: [],
            format,
            totalEstimate: 0,
            message:
              'Preview is not available for Excel files. The file will be processed during import.',
          },
          reply
        );
      } else {
        return fail(
          'import.preview',
          'UNSUPPORTED_FORMAT',
          `Cannot preview format: ${format}`,
          reply,
          400
        );
      }

      if (fields.length === 0 && records.length > 0) {
        fields = Object.keys(records[0]);
      }

      return ok('import.preview', { records, fields, format, totalEstimate }, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('import.preview', 'PREVIEW_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /upload/:filename — remove a specific temp file
  // -----------------------------------------------------------------------
  fastify.delete('/upload/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filename } = request.params as { filename: string };

    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return fail('upload.delete', 'INVALID_FILENAME', 'Invalid filename', reply, 400);
    }

    const filePath = join(UPLOAD_DIR, filename);

    try {
      await unlink(filePath);
      return ok('upload.delete', { deleted: filename }, reply);
    } catch {
      return fail('upload.delete', 'NOT_FOUND', 'File not found', reply, 404);
    }
  });

  done();
};

/** Max age for temp files before automatic cleanup (1 hour) */
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Clean up temp files older than TEMP_FILE_MAX_AGE_MS.
 * Called periodically as a safety net.
 */
export async function cleanupTempFiles(): Promise<number> {
  let cleaned = 0;
  try {
    const entries = await readdir(UPLOAD_DIR);
    const now = Date.now();

    for (const entry of entries) {
      try {
        const filePath = join(UPLOAD_DIR, entry);
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
          await unlink(filePath);
          cleaned++;
        }
      } catch {
        // Skip files that can't be stat'd or deleted
      }
    }
  } catch {
    // Upload dir may not exist yet
  }
  return cleaned;
}

/**
 * Remove a specific temp file by path (used after successful import).
 */
export async function removeTempFile(filePath: string): Promise<void> {
  try {
    const resolved = resolve(UPLOAD_DIR, basename(filePath));
    if (resolved.startsWith(UPLOAD_DIR)) {
      await unlink(resolved);
    }
  } catch {
    // Best-effort cleanup
  }
}

export default uploadRoutes;
