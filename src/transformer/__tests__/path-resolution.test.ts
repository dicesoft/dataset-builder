/**
 * Regression tests for transform path resolution and asset filtering
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { filterAssets } from '../deterministic';
import { AssetRecord } from '../../downloader/types';

describe('assetDir path resolution', () => {
  it('should use directory directly when input is a directory', () => {
    // Simulate the logic from transform.ts
    const inputResolved = path.resolve('/output/task_abc123');
    const inputIsDir = true; // fs.stat would return isDirectory() = true

    const assetDir = inputIsDir ? inputResolved : path.dirname(inputResolved);

    expect(assetDir).toBe(inputResolved);
    // The key assertion: assetDir should NOT strip the task folder
    expect(assetDir).not.toBe(path.dirname(inputResolved));
  });

  it('should use parent directory when input is a file', () => {
    const inputResolved = path.resolve('/output/task_abc123/manifest.json');
    const inputIsDir = false;

    const assetDir = inputIsDir ? inputResolved : path.dirname(inputResolved);

    expect(assetDir).toBe(path.dirname(inputResolved));
    expect(assetDir).toBe(path.resolve('/output/task_abc123'));
  });

  it('should resolve asset localPath correctly with directory input', () => {
    const taskDir = path.resolve('/output/task_abc123');
    const inputIsDir = true;
    const assetDir = inputIsDir ? taskDir : path.dirname(taskDir);

    // Manifest stores localPath relative to the task folder
    const localPath = 'downloads/images/photo.jpg';
    const fullPath = path.resolve(assetDir, localPath);

    expect(fullPath).toBe(path.resolve('/output/task_abc123/downloads/images/photo.jpg'));
  });

  it('should resolve asset localPath correctly with file input', () => {
    const inputFile = path.resolve('/output/task_abc123/manifest.json');
    const inputIsDir = false;
    const assetDir = inputIsDir ? inputFile : path.dirname(inputFile);

    const localPath = 'downloads/images/photo.jpg';
    const fullPath = path.resolve(assetDir, localPath);

    expect(fullPath).toBe(path.resolve('/output/task_abc123/downloads/images/photo.jpg'));
  });
});

describe('filterAssets', () => {
  const makeAsset = (overrides: Partial<AssetRecord>): AssetRecord => ({
    id: 'test-id',
    sourceUrl: 'https://example.com/image.jpg',
    fileName: 'image.jpg',
    localPath: 'downloads/images/image.jpg',
    status: 'completed',
    fileType: 'image',
    fileSize: 50000,
    downloadedAt: '2026-01-01T00:00:00Z',
    duration: 100,
    sourcePageUrl: 'https://example.com',
    sourcePageTitle: 'Test Page',
    context: { altText: null, surroundingText: null, pageDepth: 0, tags: [] },
    relevance: { score: null, matchesTarget: null, reason: null },
    ...overrides,
  });

  it('should keep assets with status: completed', () => {
    const assets = [makeAsset({ status: 'completed' })];
    const result = filterAssets(assets);
    expect(result).toHaveLength(1);
  });

  it('should skip assets with status: failed', () => {
    const assets = [makeAsset({ status: 'failed' })];
    const result = filterAssets(assets);
    expect(result).toHaveLength(0);
  });

  it('should skip assets with status: pending', () => {
    const assets = [makeAsset({ status: 'pending' })];
    const result = filterAssets(assets);
    expect(result).toHaveLength(0);
  });

  it('should skip assets without localPath', () => {
    const assets = [makeAsset({ localPath: '' })];
    const result = filterAssets(assets);
    expect(result).toHaveLength(0);
  });

  it('should skip assets with undefined localPath', () => {
    const assets = [makeAsset({ localPath: undefined as unknown as string })];
    const result = filterAssets(assets);
    expect(result).toHaveLength(0);
  });

  it('should filter mixed assets correctly', () => {
    const assets = [
      makeAsset({ id: '1', status: 'completed', localPath: 'downloads/a.jpg' }),
      makeAsset({ id: '2', status: 'failed', localPath: 'downloads/b.jpg' }),
      makeAsset({ id: '3', status: 'completed', localPath: '' }),
      makeAsset({ id: '4', status: 'completed', localPath: 'downloads/c.jpg' }),
      makeAsset({ id: '5', status: 'pending', localPath: 'downloads/d.jpg' }),
    ];
    const result = filterAssets(assets);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(['1', '4']);
  });
});
