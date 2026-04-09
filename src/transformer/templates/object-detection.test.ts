import { describe, it, expect, vi, beforeEach } from 'vitest';
import { objectDetectionTemplate } from './object-detection';
import type { TransformOptions, AssetRecord } from '../types';

// Mock dependencies
vi.mock('../vision-processor', () => ({
  detectObjects: vi.fn(),
  SUPPORTED_VISION_FORMATS: new Set(['.jpg', '.jpeg', '.png', '.bmp']),
  VisionAbortError: class VisionAbortError extends Error {
    results: Map<string, unknown>;
    constructor(msg: string, results: Map<string, unknown>) {
      super(msg);
      this.results = results;
    }
  },
}));

vi.mock('../python-runner', () => ({
  runPythonScript: vi.fn(),
  checkPythonPackage: vi.fn(),
  findPython: vi.fn().mockResolvedValue('python3'),
}));

vi.mock('../image-utils', () => ({
  getImageDimensions: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
}));

vi.mock('../deterministic', () => ({
  filterAssets: vi.fn((assets: unknown[]) => assets),
  deduplicateRecords: vi.fn((records: unknown[]) => records),
  inferLabelFromContext: vi.fn(() => 'object'),
}));

const { detectObjects } = await import('../vision-processor');
const { runPythonScript, checkPythonPackage } = await import('../python-runner');

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
    template: 'object-detection',
    relevanceThreshold: 0.25,
    batchSize: 10,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: true,
    ...overrides,
  };
}

describe('object-detection template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('should have correct metadata', () => {
    expect(objectDetectionTemplate.name).toBe('object-detection');
    expect(objectDetectionTemplate.supportedInputs).toEqual(['image']);
    expect(objectDetectionTemplate.usesVision).toBe(true);
  });

  it('should use YOLO engine by default when ultralytics available', async () => {
    vi.mocked(checkPythonPackage).mockResolvedValue(true);
    vi.mocked(runPythonScript).mockResolvedValue({
      success: true,
      output: '',
      error: '',
      jsonOutput: {
        objects: [
          { label: 'cat', bbox: [10, 20, 50, 60], confidence: 0.95 },
          { label: 'dog', bbox: [100, 200, 80, 90], confidence: 0.85 },
        ],
        image_width: 800,
        image_height: 600,
      },
    });

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await objectDetectionTemplate.process(assets, makeOptions());

    expect(result.records.length).toBe(2);
    expect(result.stats.inputCount).toBe(1);

    const rec = result.records[0] as Record<string, unknown>;
    expect(rec.category).toBe('cat');
    expect(rec.bbox).toEqual([10, 20, 50, 60]);
    expect(rec.confidence).toBe(0.95);
    expect(rec.image_width).toBe(800);
    expect(rec.image_height).toBe(600);
  });

  it('should use VLLM engine when model is non-YOLO', async () => {
    vi.mocked(detectObjects).mockResolvedValue(
      new Map([
        [
          '1',
          {
            objects: [
              {
                label: 'person',
                bbox: [50, 50, 100, 200] as [number, number, number, number],
                confidence: 0.8,
              },
            ],
            image_width: 800,
            image_height: 600,
          },
        ],
      ])
    );

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await objectDetectionTemplate.process(assets, makeOptions({ model: 'llava' }));

    expect(detectObjects).toHaveBeenCalled();
    expect(result.records.length).toBe(1);
    const rec = result.records[0] as Record<string, unknown>;
    expect(rec.category).toBe('person');
  });

  it('should generate deterministic fallback with --no-llm', async () => {
    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await objectDetectionTemplate.process(assets, makeOptions({ noLlm: true }));

    expect(result.records.length).toBe(1);
    const rec = result.records[0] as Record<string, unknown>;
    expect(rec.category).toBe('object');
    expect(rec.confidence).toBe(0.5);
    expect(rec.bbox).toEqual([0, 0, 800, 600]);
  });

  it('should filter by confidence threshold', async () => {
    vi.mocked(checkPythonPackage).mockResolvedValue(true);
    vi.mocked(runPythonScript).mockResolvedValue({
      success: true,
      output: '',
      error: '',
      jsonOutput: {
        objects: [
          { label: 'cat', bbox: [10, 20, 50, 60], confidence: 0.95 },
          { label: 'blur', bbox: [0, 0, 5, 5], confidence: 0.1 },
        ],
        image_width: 800,
        image_height: 600,
      },
    });

    const assets = [makeAsset('1', 'images/test.jpg')];
    const result = await objectDetectionTemplate.process(
      assets,
      makeOptions({ relevanceThreshold: 0.5 })
    );

    // Only the cat should pass the 0.5 threshold
    expect(result.records.length).toBe(1);
    expect((result.records[0] as Record<string, unknown>).category).toBe('cat');
  });

  it('should handle deduplication', async () => {
    const { deduplicateRecords } = await import('../deterministic');
    vi.mocked(deduplicateRecords).mockImplementation((records) => [records[0]]);

    vi.mocked(checkPythonPackage).mockResolvedValue(true);
    vi.mocked(runPythonScript).mockResolvedValue({
      success: true,
      output: '',
      error: '',
      jsonOutput: {
        objects: [{ label: 'cat', bbox: [10, 20, 50, 60], confidence: 0.95 }],
        image_width: 800,
        image_height: 600,
      },
    });

    const assets = [makeAsset('1', 'images/a.jpg'), makeAsset('2', 'images/b.jpg')];
    const result = await objectDetectionTemplate.process(assets, makeOptions({ dedupe: true }));

    expect(deduplicateRecords).toHaveBeenCalled();
    expect(result.records.length).toBe(1);
  });
});
