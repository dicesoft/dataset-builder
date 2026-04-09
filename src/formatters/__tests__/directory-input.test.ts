/**
 * Tests for directory input auto-resolution in the format command
 * Phase 4: Format Command Error Fix
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadData, resolveDirectoryInput } from '../utils';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `fmt-dir-${prefix}-`));
}

async function cleanDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

describe('directory input resolution', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir('test');
  });

  afterEach(async () => {
    await cleanDir(tempDir);
  });

  describe('resolveDirectoryInput', () => {
    it('resolves to classified.json when present', async () => {
      const dataFile = path.join(tempDir, 'classified.json');
      await fs.writeFile(dataFile, JSON.stringify([{ label: 'cat' }]));

      const resolved = await resolveDirectoryInput(tempDir);
      expect(resolved).toBe(dataFile);
    });

    it('resolves to transformed.json when classified.json is absent', async () => {
      const dataFile = path.join(tempDir, 'transformed.json');
      await fs.writeFile(dataFile, JSON.stringify([{ label: 'dog' }]));

      const resolved = await resolveDirectoryInput(tempDir);
      expect(resolved).toBe(dataFile);
    });

    it('prefers classified.json over transformed.json', async () => {
      await fs.writeFile(path.join(tempDir, 'classified.json'), JSON.stringify([{ a: 1 }]));
      await fs.writeFile(path.join(tempDir, 'transformed.json'), JSON.stringify([{ b: 2 }]));

      const resolved = await resolveDirectoryInput(tempDir);
      expect(resolved).toBe(path.join(tempDir, 'classified.json'));
    });

    it('returns null when no known data file exists', async () => {
      // Empty directory
      const resolved = await resolveDirectoryInput(tempDir);
      expect(resolved).toBeNull();
    });

    it('resolves JSONL files', async () => {
      const dataFile = path.join(tempDir, 'classified.jsonl');
      await fs.writeFile(dataFile, '{"label":"cat"}\n{"label":"dog"}');

      const resolved = await resolveDirectoryInput(tempDir);
      expect(resolved).toBe(dataFile);
    });
  });

  describe('loadData with directory input', () => {
    it('loads data from directory containing classified.json', async () => {
      const records = [{ label: 'cat', image: 'img1.jpg' }];
      await fs.writeFile(path.join(tempDir, 'classified.json'), JSON.stringify(records));

      const data = await loadData(tempDir);
      expect(data).toEqual(records);
    });

    it('throws helpful error when directory has no known data file', async () => {
      // Write an unrecognized file so directory is not empty
      await fs.writeFile(path.join(tempDir, 'random.txt'), 'hello');

      await expect(loadData(tempDir)).rejects.toThrow(/Input is a directory/);
      await expect(loadData(tempDir)).rejects.toThrow(/Specify a file/);
    });

    it('throws helpful error for empty directory', async () => {
      await expect(loadData(tempDir)).rejects.toThrow(/Input is a directory/);
    });

    it('still loads direct file paths as before (no regression)', async () => {
      const records = [{ instruction: 'test', output: 'result' }];
      const filePath = path.join(tempDir, 'classified.json');
      await fs.writeFile(filePath, JSON.stringify(records));

      const data = await loadData(filePath);
      expect(data).toEqual(records);
    });
  });
});
