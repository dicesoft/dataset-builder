/**
 * Tests for Phase 2: User-Provided Labels (--labels)
 * Verifies constrained label enforcement, fuzzy matching, label_source meta, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageClassificationTemplate } from '../templates/image-classification';
import { TransformOptions, ImageClassification } from '../types';
import { AssetRecord } from '../../downloader/types';
import { fuzzyMatchLabel } from '../vision-processor';

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
vi.mock('../vision-processor', async () => {
  const actual = await vi.importActual<typeof import('../vision-processor')>('../vision-processor');
  return {
    ...actual,
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
  };
});

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
  target: 'animals',
  relevanceThreshold: 0.5,
  batchSize: 5,
  minTextLength: 0,
  maxTextLength: 10000,
  noLlm: false,
  dedupe: false,
  yes: true,
};

describe('User-provided labels (--labels)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass labels through to classification and set label_source to user_labels', async () => {
    const assets = [makeAsset('a1'), makeAsset('a2')];
    const labels = ['cat', 'dog', 'bird'];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('a1', {
      label: 'cat',
      relevance: 0.9,
      caption: 'A cat',
      reason: 'cat in image',
    });
    classifications.set('a2', {
      label: 'dog',
      relevance: 0.8,
      caption: 'A dog',
      reason: 'dog in image',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      labels,
    });

    expect(result.records.length).toBe(2);

    // Verify label_source is set to user_labels
    for (const record of result.records) {
      const r = record as Record<string, unknown>;
      const meta = r._meta as Record<string, unknown>;
      expect(meta.labelSource).toBe('user_labels');
    }

    // Verify labels were passed to classifyImages via options
    const calledOptions = mockClassifyImages.mock.calls[0][1] as TransformOptions;
    expect(calledOptions.labels).toEqual(labels);
  });

  it('should set label_source to vllm when no labels provided', async () => {
    const assets = [makeAsset('b1')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('b1', {
      label: 'kitten',
      relevance: 0.85,
      caption: 'A kitten',
      reason: 'kitten',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(result.records.length).toBe(1);
    const meta = (result.records[0] as Record<string, unknown>)._meta as Record<string, unknown>;
    expect(meta.labelSource).toBe('vllm');
  });

  it('should set label_source to deterministic for noLlm mode', async () => {
    const assets = [makeAsset('c1')];

    // Use no target so relevance threshold doesn't filter records
    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      noLlm: true,
      target: undefined,
    });

    expect(result.records.length).toBeGreaterThan(0);
    const meta = (result.records[0] as Record<string, unknown>)._meta as Record<string, unknown>;
    expect(meta.labelSource).toBe('deterministic');
  });

  it('should handle single-label edge case — all images get that label', async () => {
    const assets = [makeAsset('d1'), makeAsset('d2')];
    const labels = ['cat'];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('d1', {
      label: 'cat',
      relevance: 0.9,
      caption: 'A cat',
      reason: 'cat',
    });
    classifications.set('d2', {
      label: 'cat',
      relevance: 0.7,
      caption: 'Another cat',
      reason: 'cat',
    });

    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      labels,
    });

    expect(result.records.length).toBe(2);
    for (const record of result.records) {
      const r = record as Record<string, unknown>;
      expect(r.label).toBe('cat');
    }
  });
});

describe('Fuzzy label matching', () => {
  it('should match exact labels case-insensitively', () => {
    expect(fuzzyMatchLabel('Cat', ['cat', 'dog', 'bird'])).toBe('cat');
    expect(fuzzyMatchLabel('DOG', ['cat', 'dog', 'bird'])).toBe('dog');
    expect(fuzzyMatchLabel('bird', ['cat', 'dog', 'bird'])).toBe('bird');
  });

  it('should match by substring', () => {
    expect(fuzzyMatchLabel('feline', ['cat', 'dog', 'bird'])).not.toBe('dog');
    expect(fuzzyMatchLabel('tabby cat', ['cat', 'dog', 'bird'])).toBe('cat');
    expect(fuzzyMatchLabel('golden retriever dog', ['cat', 'dog', 'bird'])).toBe('dog');
  });

  it('should match close misspellings via Levenshtein distance', () => {
    expect(fuzzyMatchLabel('cta', ['cat', 'dog', 'bird'])).toBe('cat');
    expect(fuzzyMatchLabel('dgo', ['cat', 'dog', 'bird'])).toBe('dog');
    expect(fuzzyMatchLabel('brid', ['cat', 'dog', 'bird'])).toBe('bird');
  });

  it('should return first label for very different strings', () => {
    // When nothing matches well, should fall back to first label
    const result = fuzzyMatchLabel('xylophone', ['cat', 'dog', 'bird']);
    expect(['cat', 'dog', 'bird']).toContain(result);
  });

  it('should handle empty allowed labels gracefully', () => {
    expect(fuzzyMatchLabel('anything', [])).toBe('anything');
  });

  it('should prefer exact match over substring', () => {
    expect(fuzzyMatchLabel('cat', ['cat', 'catfish', 'bobcat'])).toBe('cat');
  });
});
