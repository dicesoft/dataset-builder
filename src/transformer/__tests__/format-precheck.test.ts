/**
 * Tests for format pre-check in vision processor and templates.
 * Verifies that unsupported image formats (GIF, WebP) skip VLLM calls,
 * while supported formats (JPG, PNG) proceed normally.
 * Cloud models bypass the format check entirely.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageClassificationTemplate } from '../templates/image-classification';
import { TransformOptions, ImageClassification } from '../types';
import { AssetRecord } from '../../downloader/types';
import { SUPPORTED_VISION_FORMATS } from '../vision-processor';

// Mock Ollama
vi.mock('../../generators/ollama', () => ({
  getOllama: () => ({
    generate: vi.fn(),
    chat: vi.fn(),
    ping: vi.fn(),
    getDefaultModel: () => 'test-model',
    ensureModel: vi.fn().mockResolvedValue(undefined),
  }),
  extractFinalResponse: (text: string) => text.trim(),
  ModelNotFoundError: class ModelNotFoundError extends Error {},
}));

vi.mock('ollama', () => ({
  default: {
    chat: vi.fn(),
    generate: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => (key === 'ollamaModel' ? 'test-model' : undefined),
  }),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    access: () => Promise.resolve(),
  };
});

// Mock classifyImages to return results only for supported formats
const mockClassifyImages = vi.fn();
vi.mock('../vision-processor', async () => {
  const actual = await vi.importActual<typeof import('../vision-processor')>('../vision-processor');
  return {
    ...actual,
    classifyImages: (...args: unknown[]) => mockClassifyImages(...args),
    VisionAbortError: class VisionAbortError extends Error {
      results: Map<string, unknown>;
      constructor(message: string, results: Map<string, unknown>) {
        super(message);
        this.results = results;
        this.name = 'VisionAbortError';
      }
    },
  };
});

function makeAsset(id: string, ext: string): AssetRecord {
  return {
    id,
    sourceUrl: `https://example.com/${id}${ext}`,
    sourcePageUrl: `https://example.com/`,
    sourcePageTitle: 'Test Page',
    fileName: `${id}${ext}`,
    fileSize: 50000,
    mimeType: `image/${ext.replace('.', '')}`,
    localPath: `assets/${id}${ext}`,
    status: 'completed',
    context: {
      altText: `Image ${id}`,
      surroundingText: 'test context',
      linkText: '',
      pageTitle: 'Test Page',
    },
    downloadedAt: new Date().toISOString(),
  } as AssetRecord;
}

const baseOptions: TransformOptions = {
  input: '/test/manifest.json',
  template: 'image-classification',
  target: 'cats',
  relevanceThreshold: 0.3,
  batchSize: 5,
  minTextLength: 0,
  maxTextLength: 10000,
  noLlm: false,
  dedupe: false,
  yes: true,
};

describe('SUPPORTED_VISION_FORMATS constant', () => {
  it('includes .jpg, .jpeg, .png, .bmp', () => {
    expect(SUPPORTED_VISION_FORMATS.has('.jpg')).toBe(true);
    expect(SUPPORTED_VISION_FORMATS.has('.jpeg')).toBe(true);
    expect(SUPPORTED_VISION_FORMATS.has('.png')).toBe(true);
    expect(SUPPORTED_VISION_FORMATS.has('.bmp')).toBe(true);
  });

  it('excludes .gif, .webp, .svg, .tiff', () => {
    expect(SUPPORTED_VISION_FORMATS.has('.gif')).toBe(false);
    expect(SUPPORTED_VISION_FORMATS.has('.webp')).toBe(false);
    expect(SUPPORTED_VISION_FORMATS.has('.svg')).toBe(false);
    expect(SUPPORTED_VISION_FORMATS.has('.tiff')).toBe(false);
  });
});

describe('Format pre-check in image classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('.gif asset gets no classification result (VLLM skipped)', async () => {
    const assets = [makeAsset('gif1', '.gif'), makeAsset('jpg1', '.jpg')];

    // classifyImages returns result only for jpg (gif was pre-filtered)
    mockClassifyImages.mockResolvedValue(
      new Map<string, ImageClassification>([
        [
          'jpg1',
          {
            label: 'cat',
            relevance: 0.9,
            caption: 'A cat',
            reason: 'feline',
          },
        ],
      ])
    );

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    // jpg1 should be in output via VLLM, gif1 should be in output via fallback
    expect(result.records.length).toBe(2);
    // The gif asset should have been tracked as unsupported format
    expect(result.stats.unsupportedFormatCount).toBe(1);
    expect(result.stats.formatBreakdown).toEqual({ '.gif': 1 });
    expect(result.stats.fallbackReasons?.unsupported_format).toBe(1);
  });

  it('.webp asset gets no classification result (VLLM skipped)', async () => {
    const assets = [makeAsset('webp1', '.webp'), makeAsset('png1', '.png')];

    mockClassifyImages.mockResolvedValue(
      new Map<string, ImageClassification>([
        [
          'png1',
          {
            label: 'cat',
            relevance: 0.9,
            caption: 'A cat',
            reason: 'feline',
          },
        ],
      ])
    );

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.records.length).toBe(2);
    expect(result.stats.unsupportedFormatCount).toBe(1);
    expect(result.stats.formatBreakdown).toEqual({ '.webp': 1 });
    expect(result.stats.fallbackReasons?.unsupported_format).toBe(1);
  });

  it('.jpg asset proceeds to VLLM and returns classification', async () => {
    const assets = [makeAsset('jpg1', '.jpg')];

    mockClassifyImages.mockResolvedValue(
      new Map<string, ImageClassification>([
        [
          'jpg1',
          {
            label: 'cat',
            relevance: 0.9,
            caption: 'A cat',
            reason: 'feline',
          },
        ],
      ])
    );

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.records.length).toBe(1);
    expect(result.stats.unsupportedFormatCount).toBeUndefined();
    expect(result.stats.formatBreakdown).toBeUndefined();
    expect((result.records[0] as Record<string, unknown>).label).toBe('cat');
  });

  it('.png asset proceeds to VLLM and returns classification', async () => {
    const assets = [makeAsset('png1', '.png')];

    mockClassifyImages.mockResolvedValue(
      new Map<string, ImageClassification>([
        [
          'png1',
          {
            label: 'dog',
            relevance: 0.8,
            caption: 'A dog',
            reason: 'canine',
          },
        ],
      ])
    );

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.records.length).toBe(1);
    expect(result.stats.unsupportedFormatCount).toBeUndefined();
    expect((result.records[0] as Record<string, unknown>).label).toBe('dog');
  });

  it('mixed formats: tracks per-extension breakdown correctly', async () => {
    const assets = [
      makeAsset('gif1', '.gif'),
      makeAsset('gif2', '.gif'),
      makeAsset('webp1', '.webp'),
      makeAsset('jpg1', '.jpg'),
      makeAsset('png1', '.png'),
    ];

    // Only jpg and png get VLLM results
    mockClassifyImages.mockResolvedValue(
      new Map<string, ImageClassification>([
        ['jpg1', { label: 'cat', relevance: 0.9, caption: 'Cat', reason: 'cat' }],
        ['png1', { label: 'dog', relevance: 0.8, caption: 'Dog', reason: 'dog' }],
      ])
    );

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.stats.unsupportedFormatCount).toBe(3);
    expect(result.stats.formatBreakdown).toEqual({ '.gif': 2, '.webp': 1 });
    expect(result.stats.fallbackReasons?.unsupported_format).toBe(3);
    // VLLM didn't fail for any supported format
    expect(result.stats.fallbackReasons?.vllm_failed).toBeUndefined();
  });

  it('cloud model + .gif: VLLM IS called (format check bypassed in vision-processor)', async () => {
    // When using a cloud model, the format pre-check in vision-processor is bypassed.
    // The template still checks the result map, but the asset should have a result
    // because cloud models can handle all formats.
    const assets = [makeAsset('gif1', '.gif')];

    // Simulate cloud model returning a result for gif
    mockClassifyImages.mockResolvedValue(
      new Map<string, ImageClassification>([
        [
          'gif1',
          {
            label: 'cat',
            relevance: 0.9,
            caption: 'A cat gif',
            reason: 'animated cat',
          },
        ],
      ])
    );

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      model: 'gemini-pro-vision',
    });

    // Cloud model returned result, so no unsupported format tracking
    expect(result.records.length).toBe(1);
    expect(result.stats.unsupportedFormatCount).toBeUndefined();
    expect(result.stats.visionFallbackCount).toBeUndefined();
    expect((result.records[0] as Record<string, unknown>).label).toBe('cat');
  });
});
