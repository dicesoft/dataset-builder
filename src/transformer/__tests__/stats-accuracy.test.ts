/**
 * Regression tests for transform stats accuracy
 * Ensures dropReasons only contains records NOT in output,
 * and fallbackReasons correctly tracks VLLM failures with fallback.
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

// Mock classifyImages to return partial results (simulating VLLM failures)
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
  target: 'cats',
  relevanceThreshold: 0.3,
  batchSize: 5,
  minTextLength: 0,
  maxTextLength: 10000,
  noLlm: false,
  dedupe: false,
  yes: true,
};

describe('Transform stats accuracy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dropReasons should NOT contain no_classification for records in output', async () => {
    // 5 assets, only 2 succeed VLLM — 3 get fallback
    const assets = [
      makeAsset('a1'),
      makeAsset('a2'),
      makeAsset('a3'),
      makeAsset('a4'),
      makeAsset('a5'),
    ];

    const partialResults = new Map<string, ImageClassification>();
    partialResults.set('a1', {
      label: 'cat',
      relevance: 0.9,
      caption: 'A cat',
      reason: 'looks like a cat',
    });
    partialResults.set('a3', {
      label: 'cat',
      relevance: 0.8,
      caption: 'Another cat',
      reason: 'feline',
    });

    mockClassifyImages.mockResolvedValue(partialResults);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    // All 5 should be in output (2 VLLM + 3 fallback)
    expect(result.records.length).toBe(5);

    // dropReasons should NOT have no_classification
    if (result.stats.dropReasons) {
      expect(result.stats.dropReasons.no_classification).toBeUndefined();
    }
  });

  it('fallbackReasons.vllm_failed should equal count of VLLM-failed fallback records', async () => {
    const assets = [
      makeAsset('b1'),
      makeAsset('b2'),
      makeAsset('b3'),
      makeAsset('b4'),
      makeAsset('b5'),
    ];

    // Only b1 succeeds VLLM — 4 get fallback
    const partialResults = new Map<string, ImageClassification>();
    partialResults.set('b1', {
      label: 'cat',
      relevance: 0.9,
      caption: 'A cat',
      reason: 'cat found',
    });

    mockClassifyImages.mockResolvedValue(partialResults);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    // All 5 in output
    expect(result.records.length).toBe(5);

    // fallbackReasons should track 4 VLLM failures
    expect(result.stats.fallbackReasons).toBeDefined();
    expect(result.stats.fallbackReasons!.vllm_failed).toBe(4);

    // visionFallbackCount should also be 4
    expect(result.stats.visionFallbackCount).toBe(4);
  });

  it('dropReasons should only count records NOT in output', async () => {
    const assets = [makeAsset('c1'), makeAsset('c2'), makeAsset('c3')];

    // All 3 succeed VLLM but c2 has low relevance
    const partialResults = new Map<string, ImageClassification>();
    partialResults.set('c1', { label: 'cat', relevance: 0.9, caption: 'A cat', reason: 'cat' });
    partialResults.set('c2', {
      label: 'dog',
      relevance: 0.1,
      caption: 'A dog',
      reason: 'not a cat',
    });
    partialResults.set('c3', { label: 'cat', relevance: 0.8, caption: 'Kitten', reason: 'kitten' });

    mockClassifyImages.mockResolvedValue(partialResults);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    // c2 should be dropped (relevance 0.1 < threshold 0.3)
    expect(result.records.length).toBe(2);

    // dropReasons should have below_threshold = 1
    expect(result.stats.dropReasons).toBeDefined();
    expect(result.stats.dropReasons!.below_threshold).toBe(1);

    // No fallback reasons since all succeeded VLLM
    expect(result.stats.fallbackReasons).toBeUndefined();
  });

  it('no-fallback mode should count skipped records in dropReasons, not fallbackReasons', async () => {
    const assets = [makeAsset('d1'), makeAsset('d2'), makeAsset('d3')];

    // Only d1 succeeds
    const partialResults = new Map<string, ImageClassification>();
    partialResults.set('d1', { label: 'cat', relevance: 0.9, caption: 'A cat', reason: 'cat' });

    mockClassifyImages.mockResolvedValue(partialResults);

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      noFallback: true,
    });

    // Only 1 in output (d2 and d3 skipped)
    expect(result.records.length).toBe(1);

    // dropReasons should have no_fallback = 2
    expect(result.stats.dropReasons).toBeDefined();
    expect(result.stats.dropReasons!.no_fallback).toBe(2);

    // No fallback reasons (records were dropped, not fallen back)
    expect(result.stats.fallbackReasons).toBeUndefined();
  });
});
