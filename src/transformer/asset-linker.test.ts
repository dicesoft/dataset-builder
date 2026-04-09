import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { autoLoadInput } from './asset-linker';
import { writeFile, unlink, mkdir, rmdir } from 'fs/promises';
import path from 'path';
import os from 'os';

describe('asset-linker', () => {
  describe('autoLoadInput', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await os.tmpdir();
    });

    afterEach(async () => {
      // Cleanup any temp files
    });

    it('should auto-detect plain array as scraped data', async () => {
      const arrayData = [
        {
          id: 'entry_0_abc123',
          source_url: 'http://example.com/page1',
          title: 'Test Page',
          links: [],
          depth: 0,
          text: 'This is test content',
        },
      ];

      const tempFile = path.join(tempDir, `test_scraped_${Date.now()}.json`);
      await writeFile(tempFile, JSON.stringify(arrayData, null, 2), 'utf-8');

      try {
        const result = await autoLoadInput(tempFile);

        expect(result.type).toBe('scraped');
        expect(result.scraped).toBeDefined();
        expect(result.scraped?.pages).toHaveLength(1);
        expect(result.scraped?.pages[0].id).toBe('entry_0_abc123');
        expect(result.scraped?.taskId).toBeDefined();
        expect(result.scraped?.generatedAt).toBeDefined();
      } finally {
        await unlink(tempFile).catch(() => {});
      }
    });

    it('should handle ScrapedCombined format with pages property', async () => {
      const scrapedCombined = {
        taskId: 'task_123',
        searchQuery: 'test query',
        generatedAt: new Date().toISOString(),
        pages: [
          {
            id: 'entry_0_def456',
            source_url: 'http://example.com/page2',
            title: 'Test Page 2',
            links: [],
            depth: 0,
            text: 'More test content',
          },
        ],
      };

      const tempFile = path.join(tempDir, `test_combined_${Date.now()}.json`);
      await writeFile(tempFile, JSON.stringify(scrapedCombined, null, 2), 'utf-8');

      try {
        const result = await autoLoadInput(tempFile);

        expect(result.type).toBe('scraped');
        expect(result.scraped?.pages).toHaveLength(1);
        expect(result.scraped?.taskId).toBe('task_123');
        expect(result.scraped?.searchQuery).toBe('test query');
      } finally {
        await unlink(tempFile).catch(() => {});
      }
    });

    it('should handle manifest format with assets property', async () => {
      const manifest = {
        taskId: 'task_456',
        createdAt: new Date().toISOString(),
        assets: [
          {
            id: 'asset_1',
            sourceUrl: 'http://example.com/image.jpg',
            localPath: 'downloads/image.jpg',
            fileType: 'image/jpeg',
            status: 'completed',
            context: { tags: [] },
          },
        ],
      };

      const tempFile = path.join(tempDir, `test_manifest_${Date.now()}.json`);
      await writeFile(tempFile, JSON.stringify(manifest, null, 2), 'utf-8');

      try {
        const result = await autoLoadInput(tempFile);

        expect(result.type).toBe('manifest');
        expect(result.manifest?.assets).toHaveLength(1);
        expect(result.manifest?.taskId).toBe('task_456');
      } finally {
        await unlink(tempFile).catch(() => {});
      }
    });

    it('should load manifest alongside scraped file when available', async () => {
      // Create a temp directory structure like a task folder
      const taskDir = path.join(tempDir, `test_task_${Date.now()}`);
      const downloadsDir = path.join(taskDir, 'downloads');
      await mkdir(taskDir, { recursive: true });
      await mkdir(downloadsDir, { recursive: true });

      // Create scraped data file
      const scrapedData = [
        {
          id: 'entry_0_abc123',
          source_url: 'http://example.com/page1',
          title: 'Test Page',
          links: [],
          depth: 0,
          text: 'This is test content',
          files: ['http://example.com/image1.jpg'],
        },
      ];

      const scrapedFile = path.join(taskDir, 'scraped_combined_test.json');
      await writeFile(scrapedFile, JSON.stringify(scrapedData, null, 2), 'utf-8');

      // Create manifest file in downloads folder
      const manifest = {
        taskId: 'task_789',
        searchQuery: 'test',
        generatedAt: new Date().toISOString(),
        assets: [
          {
            id: 'asset_1',
            sourceUrl: 'http://example.com/image1.jpg',
            sourcePageUrl: 'http://example.com/page1',
            localPath: 'downloads/images/image1.jpg',
            fileName: 'image1.jpg',
            fileType: 'image',
            status: 'completed',
            context: { tags: ['test'] },
          },
        ],
      };

      const manifestFile = path.join(downloadsDir, 'downloads_manifest.json');
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');

      try {
        // Load just the scraped file - should also find manifest
        const result = await autoLoadInput(scrapedFile);

        // Should return task-folder type with both manifest and scraped
        expect(result.type).toBe('task-folder');
        expect(result.scraped?.pages).toHaveLength(1);
        expect(result.manifest?.assets).toHaveLength(1);
        expect(result.manifest?.assets[0].id).toBe('asset_1');
      } finally {
        // Cleanup
        await unlink(scrapedFile).catch(() => {});
        await unlink(manifestFile).catch(() => {});
        await rmdir(downloadsDir).catch(() => {});
        await rmdir(taskDir).catch(() => {});
      }
    });
  });
});
