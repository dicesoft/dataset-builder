/**
 * Regression tests for relevance scoring and threshold filtering
 * Verifies that VLLM-returned relevance scores are properly filtered by threshold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageClassificationTemplate } from '../templates/image-classification';
import { TransformOptions, ImageClassification } from '../types';
import { AssetRecord } from '../../downloader/types';

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

// Mock classifyImages
const mockClassifyImages = vi.fn();
vi.mock('../vision-processor', () => ({
  classifyImages: (...args: unknown[]) => mockClassifyImages(...args),
  SUPPORTED_VISION_FORMATS: new Set(['.jpg', '.jpeg', '.png', '.bmp']),
  VisionAbortError: class VisionAbortError extends Error {
    results: Map<string, unknown>;
    constructor(message: string, results: Map<string, unknown>) {
      super(message);
      this.results = results;
      this.name = 'VisionAbortError';
    }
  },
}));

function makeAsset(id: string): AssetRecord {
  return {
    id,
    sourceUrl: `https://example.com/${id}.jpg`,
    sourcePageUrl: `https://example.com/`,
    sourcePageTitle: 'Test Page',
    fileName: `${id}.jpg`,
    fileSize: 50000,
    mimeType: 'image/jpeg',
    localPath: `assets/${id}.jpg`,
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
  target: 'kittens',
  relevanceThreshold: 0.5,
  batchSize: 5,
  minTextLength: 0,
  maxTextLength: 10000,
  noLlm: false,
  dedupe: false,
  yes: true,
};

describe('Relevance scoring and threshold filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should filter out images with relevance below threshold', async () => {
    const assets = [
      makeAsset('relevant1'),
      makeAsset('irrelevant1'),
      makeAsset('relevant2'),
      makeAsset('irrelevant2'),
      makeAsset('borderline'),
    ];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('relevant1', {
      label: 'kitten',
      relevance: 0.85,
      caption: 'A cute kitten',
      reason: 'Image shows a kitten',
    });
    classifications.set('irrelevant1', {
      label: 'car',
      relevance: 0.1,
      caption: 'A red car',
      reason: 'No kittens visible',
    });
    classifications.set('relevant2', {
      label: 'kitten',
      relevance: 0.72,
      caption: 'Kitten playing',
      reason: 'Kitten in the image',
    });
    classifications.set('irrelevant2', {
      label: 'logo',
      relevance: 0.25,
      caption: 'Website logo',
      reason: 'Just a logo, not a kitten',
    });
    classifications.set('borderline', {
      label: 'cat',
      relevance: 0.5,
      caption: 'A cat in background',
      reason: 'Cat partially visible',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    // relevant1 (0.85), relevant2 (0.72), borderline (0.5) should pass threshold 0.5
    expect(result.records.length).toBe(3);

    // irrelevant1 (0.1) and irrelevant2 (0.25) should be filtered out
    expect(result.stats.dropReasons).toBeDefined();
    expect(result.stats.dropReasons!.below_threshold).toBe(2);
  });

  it('should keep all images when relevance is above threshold', async () => {
    const assets = [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('a1', {
      label: 'kitten',
      relevance: 0.9,
      caption: 'Kitten',
      reason: 'kitten',
    });
    classifications.set('a2', {
      label: 'kitten',
      relevance: 0.8,
      caption: 'Kitten',
      reason: 'kitten',
    });
    classifications.set('a3', {
      label: 'kitten',
      relevance: 0.7,
      caption: 'Kitten',
      reason: 'kitten',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.records.length).toBe(3);
    expect(result.stats.dropReasons?.below_threshold).toBeUndefined();
  });

  it('should drop all images when all have low relevance', async () => {
    const assets = [makeAsset('b1'), makeAsset('b2')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('b1', {
      label: 'random',
      relevance: 0.15,
      caption: 'Random image',
      reason: 'not related',
    });
    classifications.set('b2', {
      label: 'logo',
      relevance: 0.2,
      caption: 'A logo',
      reason: 'not related',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.records.length).toBe(0);
    expect(result.stats.dropReasons!.below_threshold).toBe(2);
  });

  it('should include relevanceThreshold in stats when target is specified', async () => {
    const assets = [makeAsset('c1')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('c1', {
      label: 'kitten',
      relevance: 0.9,
      caption: 'Kitten',
      reason: 'kitten',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.stats.relevanceThreshold).toBe(0.5);
  });

  it('should not include relevanceThreshold in stats when no target', async () => {
    const assets = [makeAsset('d1')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('d1', {
      label: 'kitten',
      relevance: 0.9,
      caption: 'Kitten',
      reason: 'kitten',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      target: undefined,
    });

    expect(result.stats.relevanceThreshold).toBeUndefined();
  });

  it('should respect custom relevance threshold', async () => {
    const assets = [makeAsset('e1'), makeAsset('e2'), makeAsset('e3')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('e1', {
      label: 'kitten',
      relevance: 0.9,
      caption: 'Kitten',
      reason: 'kitten',
    });
    classifications.set('e2', {
      label: 'cat',
      relevance: 0.6,
      caption: 'A cat',
      reason: 'cat',
    });
    classifications.set('e3', {
      label: 'random',
      relevance: 0.3,
      caption: 'Random',
      reason: 'not related',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    // Use a high threshold of 0.8
    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      relevanceThreshold: 0.8,
    });

    // Only e1 (0.9) passes threshold 0.8
    expect(result.records.length).toBe(1);
    expect(result.stats.dropReasons!.below_threshold).toBe(2);
    expect(result.stats.relevanceThreshold).toBe(0.8);
  });

  it('should handle mixed VLLM results with fallback and threshold filtering', async () => {
    const assets = [makeAsset('f1'), makeAsset('f2'), makeAsset('f3'), makeAsset('f4')];

    // Only f1 and f3 get VLLM results; f2 and f4 fall back to deterministic (relevance 0.5)
    const classifications = new Map<string, ImageClassification>();
    classifications.set('f1', {
      label: 'kitten',
      relevance: 0.9,
      caption: 'Kitten',
      reason: 'kitten',
    });
    classifications.set('f3', {
      label: 'dog',
      relevance: 0.15,
      caption: 'A dog',
      reason: 'not a kitten',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    // f1 (0.9) passes, f2 (fallback 0.5) passes at threshold 0.5,
    // f3 (0.15) dropped, f4 (fallback 0.5) passes
    expect(result.records.length).toBe(3);
    expect(result.stats.dropReasons!.below_threshold).toBe(1);
    expect(result.stats.visionFallbackCount).toBe(2);
  });
});
