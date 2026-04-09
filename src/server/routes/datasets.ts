/**
 * T046: Datasets API routes
 * GET /datasets — list datasets in output directory
 * GET /datasets/:path/records — paginated records from a dataset file
 * GET /datasets/:path/records/:index — single record detail
 *
 * T047: Media file serving
 * GET /media/:path — serve media files from output directory
 */

import { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../../config';
import { ok, fail } from '../utils/envelope';
import { isWithinDir } from '../utils/paths';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import Papa from 'papaparse';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DatasetInfo {
  path: string;
  name: string;
  type: 'json' | 'jsonl' | 'csv';
  size: number;
  recordCount: number;
  modifiedAt: string;
  fields: string[];
}

interface PaginatedRecords {
  records: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  fields: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set(['.json', '.jsonl', '.csv']);

/** Internal filenames that should be excluded from dataset listings */
const INTERNAL_FILENAMES = new Set([
  'metadata.json',
  'downloads_manifest.json',
  'operations.jsonl',
  'errors.jsonl',
]);

const MEDIA_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
};

function resolveOutputDir(): string {
  const config = getConfig();
  const outputDir = config.get('outputDir');
  return path.resolve(outputDir);
}

/**
 * Recursively scan directory for supported data files.
 * Handles edge cases: empty directories, permission errors, and symlinks outside baseDir.
 */
async function scanDataFiles(dir: string, baseDir: string): Promise<string[]> {
  const files: string[] = [];

  // Guard: empty or missing directory path
  if (!dir) return files;

  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    // Permission denied or other read errors — skip with warning
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      console.warn(`[datasets] Skipping directory (permission denied): ${dir}`);
    }
    // ENOENT (missing dir) is silently skipped — already handled by caller
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip symlinks that point outside the base directory
    if (entry.isSymbolicLink()) {
      try {
        const realPath = await fs.promises.realpath(fullPath);
        if (!isWithinDir(realPath, baseDir)) {
          continue;
        }
        // Symlink points inside baseDir — check if it's a directory or file
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          if (dir === baseDir && entry.name === 'jobs') continue;
          const subFiles = await scanDataFiles(fullPath, baseDir);
          files.push(...subFiles);
        } else if (stat.isFile()) {
          if (INTERNAL_FILENAMES.has(entry.name)) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Broken symlink or permission error — skip
        continue;
      }
      continue;
    }

    if (entry.isDirectory()) {
      // Skip the jobs/ subdirectory at the top level of outputDir
      if (dir === baseDir && entry.name === 'jobs') {
        continue;
      }
      const subFiles = await scanDataFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // Skip known internal filenames
      if (INTERNAL_FILENAMES.has(entry.name)) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Extract fields from the first record of a dataset.
 */
function extractFields(records: Record<string, unknown>[]): string[] {
  if (records.length === 0) return [];
  return Object.keys(records[0]);
}

/**
 * Parse a CSV string into an array of record objects.
 * Uses papaparse for robust handling of quoted fields, embedded commas/newlines, etc.
 */
function parseCsv(content: string): Record<string, unknown>[] {
  const result = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  return result.data;
}

/**
 * Read JSON file and return records array.
 */
async function readJsonFile(filePath: string): Promise<Record<string, unknown>[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return parsed;
  return [parsed];
}

/**
 * Streaming pagination for large JSON array files.
 * Parses top-level objects from a JSON array incrementally to avoid loading
 * the entire file into memory. Falls back to full-load for small files.
 */
async function readJsonPageStreaming(
  filePath: string,
  page: number,
  pageSize: number
): Promise<{ records: Record<string, unknown>[]; total: number; fields: string[] }> {
  const fileStat = await fs.promises.stat(filePath);

  // For files under 5 MB, full-load is fast enough
  if (fileStat.size < 5 * 1024 * 1024) {
    const allRecords = await readJsonFile(filePath);
    const fields = extractFields(allRecords);
    const skip = (page - 1) * pageSize;
    return { records: allRecords.slice(skip, skip + pageSize), total: allRecords.length, fields };
  }

  // Stream-parse: extract top-level objects from a JSON array
  return new Promise((resolve, reject) => {
    const records: Record<string, unknown>[] = [];
    const skip = (page - 1) * pageSize;
    let total = 0;
    let fields: string[] = [];
    let buffer = '';
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let insideObject = false;
    let foundArray = false;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });

    stream.on('data', (chunk: string) => {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];

        if (escapeNext) {
          if (insideObject) buffer += ch;
          escapeNext = false;
          continue;
        }
        if (ch === '\\' && inString) {
          if (insideObject) buffer += ch;
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          if (insideObject) buffer += ch;
          continue;
        }
        if (inString) {
          if (insideObject) buffer += ch;
          continue;
        }

        // Outside strings
        if (ch === '[' && !foundArray && depth === 0) {
          foundArray = true;
          continue;
        }
        if (ch === '{') {
          depth++;
          if (depth === 1) {
            insideObject = true;
            buffer = '{';
          } else {
            buffer += ch;
          }
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && insideObject) {
            buffer += '}';
            if (total >= skip && records.length < pageSize) {
              try {
                const record = JSON.parse(buffer);
                records.push(record);
                if (fields.length === 0) fields = Object.keys(record);
              } catch {
                /* skip malformed */
              }
            }
            total++;
            insideObject = false;
            buffer = '';
          } else if (insideObject) {
            buffer += ch;
          }
        } else if (insideObject) {
          buffer += ch;
        }
      }
    });

    stream.on('end', () => resolve({ records, total, fields }));
    stream.on('error', reject);
  });
}

/**
 * Count lines in a JSONL file efficiently using streaming.
 */
async function countJsonlLines(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (line.trim().length > 0) count++;
    });
    rl.on('close', () => resolve(count));
    rl.on('error', reject);
  });
}

/**
 * Read a page of records from a JSONL file using streaming.
 */
async function readJsonlPage(
  filePath: string,
  page: number,
  pageSize: number
): Promise<{ records: Record<string, unknown>[]; total: number }> {
  return new Promise((resolve, reject) => {
    const records: Record<string, unknown>[] = [];
    let lineIndex = 0;
    const skip = (page - 1) * pageSize;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let total = 0;

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      total++;

      if (lineIndex >= skip && records.length < pageSize) {
        try {
          records.push(JSON.parse(trimmed));
        } catch {
          // Skip malformed lines
        }
      }
      lineIndex++;
    });

    rl.on('close', () => resolve({ records, total }));
    rl.on('error', reject);
  });
}

/**
 * Read a single record from a JSONL file by index using streaming.
 */
async function readJsonlRecord(
  filePath: string,
  index: number
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    let lineIndex = 0;

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      if (lineIndex === index) {
        try {
          resolve(JSON.parse(trimmed));
        } catch {
          resolve(null);
        }
        rl.close();
        stream.destroy();
      }
      lineIndex++;
    });

    rl.on('close', () => resolve(null));
    rl.on('error', reject);
  });
}

/**
 * Get dataset info for a single file.
 */
async function getDatasetInfo(filePath: string, outputDir: string): Promise<DatasetInfo> {
  const stat = await fs.promises.stat(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1) as 'json' | 'jsonl' | 'csv';
  const relativePath = path.relative(outputDir, filePath).replace(/\\/g, '/');

  let recordCount = 0;
  let fields: string[] = [];

  try {
    if (ext === 'jsonl') {
      // Stream count lines for efficiency
      recordCount = await countJsonlLines(filePath);
      // Read first line for fields
      const { records } = await readJsonlPage(filePath, 1, 1);
      fields = extractFields(records);
    } else if (ext === 'json') {
      const records = await readJsonFile(filePath);
      recordCount = records.length;
      fields = extractFields(records);
    } else if (ext === 'csv') {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const records = parseCsv(content);
      recordCount = records.length;
      fields = extractFields(records);
    }
  } catch {
    // If we can't parse the file, return 0 records
  }

  return {
    path: relativePath,
    name: path.basename(filePath),
    type: ext,
    size: stat.size,
    recordCount,
    modifiedAt: stat.mtime.toISOString(),
    fields,
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface DatasetsRouteOptions {
  /** Optional output directory override (for testing). */
  outputDir?: string;
}

const datasetsRoutes: FastifyPluginCallback<DatasetsRouteOptions> = (
  fastify: FastifyInstance,
  opts: DatasetsRouteOptions,
  done
) => {
  const getOutputDir = () => opts.outputDir ?? resolveOutputDir();

  // -----------------------------------------------------------------------
  // GET /datasets — list all datasets
  // -----------------------------------------------------------------------
  fastify.get('/datasets', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const outputDir = getOutputDir();

      if (!fs.existsSync(outputDir)) {
        return ok('datasets.list', { datasets: [] }, reply);
      }

      const filePaths = await scanDataFiles(outputDir, outputDir);
      const datasets: DatasetInfo[] = [];

      for (const filePath of filePaths) {
        try {
          const info = await getDatasetInfo(filePath, outputDir);
          datasets.push(info);
        } catch {
          // Skip files that can't be read
        }
      }

      // Sort by modification date descending
      datasets.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

      return ok('datasets.list', { datasets }, reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('datasets.list', 'SCAN_FAILED', message, reply, 500);
    }
  });

  // -----------------------------------------------------------------------
  // GET /datasets/:path/records — paginated records
  // -----------------------------------------------------------------------
  fastify.get(
    '/datasets/:path/records',
    async (
      request: FastifyRequest<{
        Params: { path: string };
        Querystring: {
          page?: string;
          pageSize?: string;
          sort?: string;
          filter?: string;
          search?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { path: encodedPath } = request.params;
      const { page: pageStr, pageSize: pageSizeStr, sort, filter, search } = request.query;

      const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);
      const pageSize = Math.max(1, Math.min(500, parseInt(pageSizeStr || '50', 10) || 50));

      try {
        const outputDir = getOutputDir();
        // Normalize backslashes to forward slashes (Windows paths from job results)
        // and strip leading "output/" prefix that older job records may include.
        let decodedPath = decodeURIComponent(encodedPath).replace(/\\/g, '/');
        const outputDirBase = path.basename(outputDir);
        if (decodedPath.startsWith(`${outputDirBase}/`)) {
          decodedPath = decodedPath.slice(outputDirBase.length + 1);
        }
        const filePath = path.resolve(outputDir, decodedPath);

        // Path traversal check
        if (!isWithinDir(filePath, outputDir)) {
          return fail('datasets.records', 'FORBIDDEN', 'Path traversal not allowed', reply, 403);
        }

        if (!fs.existsSync(filePath)) {
          return fail('datasets.records', 'NOT_FOUND', 'Dataset file not found', reply, 404);
        }

        const ext = path.extname(filePath).toLowerCase();
        let records: Record<string, unknown>[] = [];
        let total = 0;
        let fields: string[] = [];

        const hasSearchOrSort = (search && search.trim().length > 0) || sort;

        // Sort helper used across all branches
        const applySortFn = (arr: Record<string, unknown>[]) => {
          if (!sort) return;
          const sortField = sort.replace(/^-/, '');
          const desc = sort.startsWith('-');
          arr.sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
            return desc ? -cmp : cmp;
          });
        };

        // Search helper
        const applySearchFn = (arr: Record<string, unknown>[]): Record<string, unknown>[] => {
          if (!search || search.trim().length === 0) return arr;
          const searchLower = search.toLowerCase();
          return arr.filter((r) =>
            Object.values(r).some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(searchLower)
            )
          );
        };

        if (ext === '.jsonl') {
          if (hasSearchOrSort) {
            // Must load all records to search/sort across full dataset
            const allResult = await readJsonlPage(filePath, 1, Infinity);
            let allRecords = allResult.records;
            fields = extractFields(allRecords);
            allRecords = applySearchFn(allRecords);
            applySortFn(allRecords);
            total = allRecords.length;
            records = allRecords.slice((page - 1) * pageSize, page * pageSize);
          } else {
            const result = await readJsonlPage(filePath, page, pageSize);
            records = result.records;
            total = result.total;
            fields = extractFields(records);
          }
        } else if (ext === '.json' || ext === '.csv') {
          if (hasSearchOrSort) {
            // Need all records for search/sort before paginating
            const allRecords =
              ext === '.json'
                ? await readJsonFile(filePath)
                : parseCsv(await fs.promises.readFile(filePath, 'utf-8'));
            fields = extractFields(allRecords);
            let filtered = applySearchFn(allRecords);
            applySortFn(filtered);
            total = filtered.length;
            records = filtered.slice((page - 1) * pageSize, page * pageSize);
          } else {
            // No search/sort — use streaming for large JSON files
            if (ext === '.json') {
              const result = await readJsonPageStreaming(filePath, page, pageSize);
              records = result.records;
              total = result.total;
              fields = result.fields;
            } else {
              const content = await fs.promises.readFile(filePath, 'utf-8');
              const allRecords = parseCsv(content);
              total = allRecords.length;
              fields = extractFields(allRecords);
              records = allRecords.slice((page - 1) * pageSize, page * pageSize);
            }
          }
        } else {
          return fail(
            'datasets.records',
            'UNSUPPORTED_TYPE',
            `Unsupported file type: ${ext}`,
            reply,
            400
          );
        }

        const result: PaginatedRecords = { records, total, page, pageSize, fields };
        return ok('datasets.records', result, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('datasets.records', 'READ_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /datasets/:path/records/:index — single record
  // -----------------------------------------------------------------------
  fastify.get(
    '/datasets/:path/records/:index',
    async (
      request: FastifyRequest<{
        Params: { path: string; index: string };
      }>,
      reply: FastifyReply
    ) => {
      const { path: encodedPath, index: indexStr } = request.params;
      const index = parseInt(indexStr, 10);

      if (isNaN(index) || index < 0) {
        return fail(
          'datasets.record',
          'INVALID_INDEX',
          'Index must be a non-negative integer',
          reply,
          400
        );
      }

      try {
        const outputDir = getOutputDir();
        const decodedPath = decodeURIComponent(encodedPath);
        const filePath = path.resolve(outputDir, decodedPath);

        if (!isWithinDir(filePath, outputDir)) {
          return fail('datasets.record', 'FORBIDDEN', 'Path traversal not allowed', reply, 403);
        }

        if (!fs.existsSync(filePath)) {
          return fail('datasets.record', 'NOT_FOUND', 'Dataset file not found', reply, 404);
        }

        const ext = path.extname(filePath).toLowerCase();
        let record: Record<string, unknown> | null = null;

        if (ext === '.jsonl') {
          record = await readJsonlRecord(filePath, index);
        } else if (ext === '.json') {
          const records = await readJsonFile(filePath);
          record = records[index] ?? null;
        } else if (ext === '.csv') {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const records = parseCsv(content);
          record = records[index] ?? null;
        } else {
          return fail(
            'datasets.record',
            'UNSUPPORTED_TYPE',
            `Unsupported file type: ${ext}`,
            reply,
            400
          );
        }

        if (record === null) {
          return fail(
            'datasets.record',
            'NOT_FOUND',
            `Record at index ${index} not found`,
            reply,
            404
          );
        }

        return ok('datasets.record', { record, index }, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('datasets.record', 'READ_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /datasets/:path/fields — extract field names from first record
  // -----------------------------------------------------------------------
  fastify.get(
    '/datasets/:path/fields',
    async (
      request: FastifyRequest<{
        Params: { path: string };
      }>,
      reply: FastifyReply
    ) => {
      const { path: encodedPath } = request.params;

      try {
        const outputDir = getOutputDir();
        const decodedPath = decodeURIComponent(encodedPath);
        const filePath = path.resolve(outputDir, decodedPath);

        if (!isWithinDir(filePath, outputDir)) {
          return fail('datasets.fields', 'FORBIDDEN', 'Path traversal not allowed', reply, 403);
        }

        if (!fs.existsSync(filePath)) {
          return fail('datasets.fields', 'NOT_FOUND', 'Dataset file not found', reply, 404);
        }

        const ext = path.extname(filePath).toLowerCase();
        let fields: string[] = [];

        if (ext === '.jsonl') {
          const { records } = await readJsonlPage(filePath, 1, 1);
          fields = extractFields(records);
        } else if (ext === '.json') {
          const records = await readJsonFile(filePath);
          fields = extractFields(records);
        } else if (ext === '.csv') {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const records = parseCsv(content);
          fields = extractFields(records);
        } else {
          return fail(
            'datasets.fields',
            'UNSUPPORTED_TYPE',
            `Unsupported file type: ${ext}`,
            reply,
            400
          );
        }

        return ok('datasets.fields', { fields }, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('datasets.fields', 'READ_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /datasets/:path/manifest — return downloads_manifest.json from the
  // dataset's task directory if it exists. Used by the gallery to filter
  // displayed images to only those that were actually downloaded.
  // -----------------------------------------------------------------------
  fastify.get(
    '/datasets/:path/manifest',
    async (request: FastifyRequest<{ Params: { path: string } }>, reply: FastifyReply) => {
      const { path: encodedPath } = request.params;

      try {
        const outputDir = getOutputDir();
        let decodedPath = decodeURIComponent(encodedPath).replace(/\\/g, '/');
        const outputDirBase = path.basename(outputDir);
        if (decodedPath.startsWith(`${outputDirBase}/`)) {
          decodedPath = decodedPath.slice(outputDirBase.length + 1);
        }
        const filePath = path.resolve(outputDir, decodedPath);

        if (!isWithinDir(filePath, outputDir)) {
          return fail('datasets.manifest', 'FORBIDDEN', 'Path traversal not allowed', reply, 403);
        }

        // Look for downloads_manifest.json in the dataset's parent directory tree.
        // Walk up from the dataset file's directory until we find one or hit outputDir.
        let dir = path.dirname(filePath);
        let manifestPath: string | null = null;
        while (dir.startsWith(outputDir) && dir !== outputDir) {
          const candidate = path.join(dir, 'downloads', 'downloads_manifest.json');
          if (fs.existsSync(candidate)) {
            manifestPath = candidate;
            break;
          }
          const parent = path.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }

        if (!manifestPath) {
          return ok('datasets.manifest', { manifest: null, sourceUrls: [] }, reply);
        }

        const content = await fs.promises.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content) as {
          assets?: Array<{ sourceUrl?: string; localPath?: string; status?: string }>;
        };

        // Build a map of sourceUrl → localPath for completed downloads only.
        // The manifest is at <taskDir>/downloads/downloads_manifest.json, so the
        // task directory is two levels up. localPath in the manifest is relative
        // to the task directory (e.g. "downloads/images/foo.jpg").
        const taskDir = path.dirname(path.dirname(manifestPath));
        const taskDirRel = path.relative(outputDir, taskDir).replace(/\\/g, '/');
        const sourceUrls: Array<{ sourceUrl: string; localPath: string }> = [];
        for (const asset of manifest.assets ?? []) {
          if (
            asset.sourceUrl &&
            asset.localPath &&
            (asset.status === 'completed' || asset.status === undefined)
          ) {
            const mediaPath = (taskDirRel ? `${taskDirRel}/` : '') + asset.localPath;
            sourceUrls.push({ sourceUrl: asset.sourceUrl, localPath: mediaPath });
          }
        }

        return ok('datasets.manifest', { manifest: { assets: sourceUrls }, sourceUrls }, reply);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail('datasets.manifest', 'READ_FAILED', message, reply, 500);
      }
    }
  );

  // -----------------------------------------------------------------------
  // GET /media/:path — serve media files
  // -----------------------------------------------------------------------
  fastify.get('/media/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPath = (request.params as Record<string, string>)['*'];

    if (!rawPath) {
      return fail('media.serve', 'INVALID_PATH', 'Media path is required', reply, 400);
    }

    try {
      const outputDir = getOutputDir();
      const decodedPath = decodeURIComponent(rawPath);
      const filePath = path.resolve(outputDir, decodedPath);

      // Path traversal prevention
      if (!isWithinDir(filePath, outputDir)) {
        return fail('media.serve', 'FORBIDDEN', 'Path traversal not allowed', reply, 403);
      }

      if (!fs.existsSync(filePath)) {
        return fail('media.serve', 'NOT_FOUND', 'File not found', reply, 404);
      }

      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return fail('media.serve', 'NOT_FOUND', 'Not a file', reply, 404);
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MEDIA_MIME_TYPES[ext] ?? 'application/octet-stream';

      // Handle range requests for video streaming
      const rangeHeader = request.headers.range;

      if (rangeHeader && contentType.startsWith('video/')) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;

        reply.status(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', chunkSize);
        reply.header('Content-Type', contentType);

        const stream = fs.createReadStream(filePath, { start, end });
        return reply.send(stream);
      }

      reply.header('Content-Type', contentType);
      reply.header('Content-Length', stat.size);
      reply.header('Accept-Ranges', 'bytes');

      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('media.serve', 'SERVE_FAILED', message, reply, 500);
    }
  });

  done();
};

export default datasetsRoutes;
