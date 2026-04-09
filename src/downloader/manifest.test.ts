/**
 * Asset Manifest tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractTags,
  generateAssetId,
  mergeManifests,
  createEmptyManifest,
  buildAssetRecord,
} from './manifest-utils';
import { AssetManifest, AssetRecord, DownloadProgress } from './types';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('manifest-utils', () => {
  describe('extractTags', () => {
    it('should extract tags from URL path segments', () => {
      const url = 'https://example.com/images/cars/sports/red-ferrari.jpg';
      const tags = extractTags('Some Page', url);

      expect(tags).toContain('images');
      expect(tags).toContain('cars');
      expect(tags).toContain('sports');
      expect(tags).toContain('red');
      expect(tags).toContain('ferrari');
    });

    it('should extract tags from page title', () => {
      const title = 'Beautiful Mountain Landscape Photography';
      const url = 'https://example.com/image.jpg';
      const tags = extractTags(title, url);

      expect(tags).toContain('beautiful');
      expect(tags).toContain('mountain');
      expect(tags).toContain('landscape');
      expect(tags).toContain('photography');
    });

    it('should filter out stop words', () => {
      const title = 'The Quick Brown Fox Jumps Over The Lazy Dog';
      const url = 'https://example.com/the/quick/brown/fox.html';
      const tags = extractTags(title, url);

      expect(tags).not.toContain('the');
      expect(tags).not.toContain('over');
      expect(tags).toContain('quick');
      expect(tags).toContain('brown');
      expect(tags).toContain('fox');
      expect(tags).toContain('jumps');
    });

    it('should extract tags from domain', () => {
      const url = 'https://github.com/user/project';
      const tags = extractTags('GitHub Page', url);

      expect(tags).toContain('github');
    });

    it('should return sorted unique tags', () => {
      const title = 'apple banana apple';
      const url = 'https://example.com/apple/banana';
      const tags = extractTags(title, url);

      const uniqueTags = [...new Set(tags)];
      expect(tags).toEqual(uniqueTags.sort());
    });

    it('should handle invalid URLs gracefully', () => {
      const tags = extractTags('Some Title', 'not-a-valid-url');
      expect(tags).toContain('some');
      expect(tags).toContain('title');
    });

    it('should exclude short words', () => {
      const title = 'A B C De Fgh';
      const url = 'https://example.com/a/b/c';
      const tags = extractTags(title, url);

      expect(tags).not.toContain('a');
      expect(tags).not.toContain('b');
      expect(tags).not.toContain('c');
      expect(tags).not.toContain('de');
      expect(tags).toContain('fgh');
    });
  });

  describe('generateAssetId', () => {
    it('should generate sequential asset IDs', () => {
      expect(generateAssetId(0)).toBe('asset_0');
      expect(generateAssetId(1)).toBe('asset_1');
      expect(generateAssetId(42)).toBe('asset_42');
      expect(generateAssetId(999)).toBe('asset_999');
    });
  });

  describe('createEmptyManifest', () => {
    it('should create an empty manifest with required fields', () => {
      const manifest = createEmptyManifest('task_123', 'search query');

      expect(manifest.taskId).toBe('task_123');
      expect(manifest.searchQuery).toBe('search query');
      expect(manifest.totalAssets).toBe(0);
      expect(manifest.version).toBe('1.0');
      expect(manifest.assets).toEqual([]);
      expect(new Date(manifest.generatedAt)).toBeInstanceOf(Date);
    });

    it('should handle null search query', () => {
      const manifest = createEmptyManifest('task_456', null);
      expect(manifest.searchQuery).toBeNull();
    });
  });

  describe('buildAssetRecord', () => {
    it('should build a complete asset record', () => {
      const progress = {
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        status: 'completed' as const,
        bytesDownloaded: 1024,
        startTime: Date.now() - 1000,
        endTime: Date.now(),
      };

      const record = buildAssetRecord(
        progress,
        0,
        'https://source-page.com',
        'Source Page Title',
        'image',
        '/output/task_123'
      );

      expect(record.id).toBe('asset_0');
      expect(record.sourceUrl).toBe('https://example.com/image.jpg');
      expect(record.sourcePageUrl).toBe('https://source-page.com');
      expect(record.sourcePageTitle).toBe('Source Page Title');
      expect(record.fileName).toBe('image.jpg');
      expect(record.fileType).toBe('image');
      expect(record.fileSize).toBe(1024);
      expect(record.status).toBe('completed');
      expect(record.localPath).toBe('downloads/images/image.jpg');
      expect(record.duration).toBeGreaterThanOrEqual(0);
      expect(record.context.tags).toBeInstanceOf(Array);
      expect(record.relevance.score).toBeNull();
      expect(record.relevance.matchesTarget).toBeNull();
      expect(record.relevance.reason).toBeNull();
    });

    it('should map file types to correct subdirectories', () => {
      const progress = {
        url: 'https://example.com/file',
        filename: 'file',
        status: 'completed' as const,
        bytesDownloaded: 100,
      };

      const types = [
        { type: 'image', expectedPath: 'downloads/images' },
        { type: 'video', expectedPath: 'downloads/videos' },
        { type: 'pdf', expectedPath: 'downloads/pdfs' },
        { type: 'docx', expectedPath: 'downloads/documents' },
        { type: 'pptx', expectedPath: 'downloads/documents' },
        { type: 'csv', expectedPath: 'downloads/csv' },
        { type: 'html', expectedPath: 'downloads/html' },
        { type: 'text', expectedPath: 'downloads/other' },
        { type: 'unknown', expectedPath: 'downloads/other' },
      ];

      for (const { type, expectedPath } of types) {
        const record = buildAssetRecord(
          { ...progress, filename: `test.${type}` },
          0,
          'https://example.com',
          'Title',
          type,
          '/output'
        );
        expect(record.localPath.startsWith(expectedPath)).toBe(true);
      }
    });

    it('should handle failed downloads', () => {
      const progress = {
        url: 'https://example.com/fail.jpg',
        filename: 'fail.jpg',
        status: 'failed' as const,
        bytesDownloaded: 0,
        startTime: Date.now() - 500,
        endTime: Date.now(),
      };

      const record = buildAssetRecord(
        progress,
        1,
        'https://source.com',
        'Source',
        'image',
        '/output'
      );

      expect(record.status).toBe('failed');
      expect(record.fileSize).toBe(0);
      expect(record.id).toBe('asset_1');
    });
  });

  describe('mergeManifests', () => {
    it('should merge two manifests without duplicates', () => {
      const existing: AssetManifest = {
        taskId: 'task_1',
        searchQuery: 'test',
        generatedAt: '2024-01-01T00:00:00Z',
        totalAssets: 2,
        version: '1.0',
        assets: [
          {
            id: 'asset_0',
            sourceUrl: 'https://example.com/old.jpg',
            sourcePageUrl: 'https://source.com',
            sourcePageTitle: 'Old',
            localPath: 'downloads/old.jpg',
            fileName: 'old.jpg',
            fileType: 'image',
            fileSize: 100,
            status: 'completed',
            downloadedAt: '2024-01-01T00:00:00Z',
            duration: 1000,
            context: {
              altText: null,
              surroundingText: null,
              pageDepth: 0,
              tags: ['old'],
            },
            relevance: { score: null, matchesTarget: null, reason: null },
          },
          {
            id: 'asset_1',
            sourceUrl: 'https://example.com/common.jpg',
            sourcePageUrl: 'https://source.com',
            sourcePageTitle: 'Common',
            localPath: 'downloads/common.jpg',
            fileName: 'common.jpg',
            fileType: 'image',
            fileSize: 200,
            status: 'completed',
            downloadedAt: '2024-01-01T00:00:00Z',
            duration: 1000,
            context: {
              altText: null,
              surroundingText: null,
              pageDepth: 0,
              tags: ['common'],
            },
            relevance: { score: null, matchesTarget: null, reason: null },
          },
        ],
      };

      const newManifest: AssetManifest = {
        taskId: 'task_1',
        searchQuery: 'test',
        generatedAt: '2024-01-02T00:00:00Z',
        totalAssets: 2,
        version: '1.0',
        assets: [
          {
            id: 'asset_0',
            sourceUrl: 'https://example.com/common.jpg', // Same URL as existing
            sourcePageUrl: 'https://source.com',
            sourcePageTitle: 'Common Updated',
            localPath: 'downloads/common.jpg',
            fileName: 'common.jpg',
            fileType: 'image',
            fileSize: 250, // Updated size
            status: 'completed',
            downloadedAt: '2024-01-02T00:00:00Z',
            duration: 500,
            context: {
              altText: null,
              surroundingText: null,
              pageDepth: 0,
              tags: ['common', 'updated'],
            },
            relevance: { score: null, matchesTarget: null, reason: null },
          },
          {
            id: 'asset_1',
            sourceUrl: 'https://example.com/new.jpg',
            sourcePageUrl: 'https://source.com',
            sourcePageTitle: 'New',
            localPath: 'downloads/new.jpg',
            fileName: 'new.jpg',
            fileType: 'image',
            fileSize: 300,
            status: 'completed',
            downloadedAt: '2024-01-02T00:00:00Z',
            duration: 1000,
            context: {
              altText: null,
              surroundingText: null,
              pageDepth: 0,
              tags: ['new'],
            },
            relevance: { score: null, matchesTarget: null, reason: null },
          },
        ],
      };

      const merged = mergeManifests(existing, newManifest);

      expect(merged.totalAssets).toBe(3);
      expect(merged.assets).toHaveLength(3);
      expect(merged.taskId).toBe('task_1');
      expect(merged.searchQuery).toBe('test');

      // Check that common.jpg was updated (new takes precedence)
      const commonAsset = merged.assets.find(
        (a) => a.sourceUrl === 'https://example.com/common.jpg'
      );
      expect(commonAsset).toBeDefined();
      expect(commonAsset?.fileSize).toBe(250); // From new manifest
      expect(commonAsset?.sourcePageTitle).toBe('Common Updated');

      // Check that old.jpg was preserved
      const oldAsset = merged.assets.find((a) => a.sourceUrl === 'https://example.com/old.jpg');
      expect(oldAsset).toBeDefined();
      expect(oldAsset?.fileSize).toBe(100);

      // Check that new.jpg was added
      const newAsset = merged.assets.find((a) => a.sourceUrl === 'https://example.com/new.jpg');
      expect(newAsset).toBeDefined();
      expect(newAsset?.fileSize).toBe(300);

      // Check that IDs are renumbered
      const ids = merged.assets.map((a) => a.id);
      expect(ids).toContain('asset_0');
      expect(ids).toContain('asset_1');
      expect(ids).toContain('asset_2');
    });

    it('should update generatedAt timestamp', () => {
      const existing = createEmptyManifest('task_1', 'test');
      const newManifest = createEmptyManifest('task_1', 'test');

      existing.generatedAt = '2024-01-01T00:00:00Z';

      // Small delay to ensure different timestamp
      const merged = mergeManifests(existing, newManifest);

      expect(merged.generatedAt).not.toBe('2024-01-01T00:00:00Z');
      expect(new Date(merged.generatedAt)).toBeInstanceOf(Date);
    });

    it('should preserve original taskId and searchQuery from existing', () => {
      const existing = createEmptyManifest('original_task', 'original_query');
      const newManifest = createEmptyManifest('new_task', 'new_query');

      const merged = mergeManifests(existing, newManifest);

      expect(merged.taskId).toBe('original_task');
      expect(merged.searchQuery).toBe('original_query');
    });
  });
});
