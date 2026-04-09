import { describe, it, expect, vi, beforeEach } from 'vitest';
import { segmentationTemplate } from './segmentation';
import type { TransformOptions, AssetRecord } from '../types';

// Mock dependencies
vi.mock('../python-runner', () => ({
  runPythonScript: vi.fn(),
  findPython: vi.fn().mockResolvedValue('python3'),
  checkPythonPackage: vi.fn().mockResolvedValue(true),
}));

vi.mock('../vision-processor', () => ({
  classifyImages: vi.fn().mockResolvedValue(new Map()),
  VisionAbortError: class extends Error {
    results: Map<string, unknown>;
    constructor(msg: string, results: Map<string, unknown>) {
      super(msg);
      this.results = results;
    }
  },
}));

vi.mock('../deterministic', () => ({
  filterAssets: vi.fn((assets: unknown[]) => assets),
  deduplicateRecords: vi.fn((records: unknown[]) => records),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

const { runPythonScript, findPython, checkPythonPackage } = await import('../python-runner');

function makeAsset(id: string, localPath: string): AssetRecord {
  return {
    id,
    sourceUrl: 'https://example.com/img.jpg',
    sourcePageUrl: 'https://example.com',
    sourcePageTitle: 'Test Page',
    fileName: localPath,
    localPath,
    fileSize: 1000,
    mimeType: 'image/jpeg',
    downloadedAt: '2024-01-01T00:00:00Z',
    context: { altText: 'test image' },
  } as AssetRecord;
}

function makeOptions(overrides: Partial<TransformOptions> = {}): TransformOptions {
  return {
    input: '/test/manifest.json',
    template: 'segmentation',
    relevanceThreshold: 0.5,
    batchSize: 10,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: true,
    dedupe: false,
    yes: true,
    ...overrides,
  };
}

describe('segmentation template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('should have correct metadata', () => {
    expect(segmentationTemplate.name).toBe('segmentation');
    expect(segmentationTemplate.supportedInputs).toEqual(['image']);
    expect(segmentationTemplate.usesVision).toBe(true);
  });

  it('should return empty results when Python not available', async () => {
    vi.mocked(findPython).mockResolvedValue(null);

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await segmentationTemplate.process(assets, makeOptions());

    expect(result.records.length).toBe(0);
    expect(result.stats.errorCount).toBe(1);
  });

  it('should return empty results when ultralytics not installed', async () => {
    vi.mocked(findPython).mockResolvedValue('python3');
    vi.mocked(checkPythonPackage).mockResolvedValue(false);

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await segmentationTemplate.process(assets, makeOptions());

    expect(result.records.length).toBe(0);
    expect(result.stats.errorCount).toBe(1);
  });

  it('should produce records from SAM output', async () => {
    vi.mocked(findPython).mockResolvedValue('python3');
    vi.mocked(checkPythonPackage).mockResolvedValue(true);
    vi.mocked(runPythonScript).mockResolvedValue({
      success: true,
      output: '',
      error: '',
      jsonOutput: {
        masks: [
          {
            label: 'segment_0',
            mask_path: '/masks/test_mask_0000.png',
            area: 5000,
            bbox: [10, 20, 100, 150],
          },
          {
            label: 'segment_1',
            mask_path: '/masks/test_mask_0001.png',
            area: 3000,
            bbox: [200, 100, 80, 90],
          },
        ],
        image_width: 800,
        image_height: 600,
      },
    });

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await segmentationTemplate.process(assets, makeOptions());

    expect(result.records.length).toBe(2);
    expect(result.stats.classifiedCount).toBe(1);

    const rec0 = result.records[0] as Record<string, unknown>;
    expect(rec0.image).toBe('images/test.jpg');
    expect(rec0.mask_path).toBe('/masks/test_mask_0000.png');
    expect(rec0.category).toBe('segment_0');
    expect(rec0.area).toBe(5000);
    expect(rec0.image_width).toBe(800);
  });

  it('should handle SAM failure gracefully', async () => {
    vi.mocked(findPython).mockResolvedValue('python3');
    vi.mocked(checkPythonPackage).mockResolvedValue(true);
    vi.mocked(runPythonScript).mockResolvedValue({
      success: false,
      output: '',
      error: 'SAM model failed',
      jsonOutput: null,
    });

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await segmentationTemplate.process(assets, makeOptions());

    expect(result.records.length).toBe(0);
    expect(result.stats.skippedCount).toBe(1);
  });
});
