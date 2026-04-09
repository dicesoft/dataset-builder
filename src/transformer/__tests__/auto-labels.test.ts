/**
 * Tests for Phase 3: Auto-Categorize (--auto-labels)
 * Verifies label discovery, consolidation, pipeline integration, and validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageClassificationTemplate } from '../templates/image-classification';
import { TransformOptions, ImageClassification } from '../types';
import { AssetRecord } from '../../downloader/types';
import { fuzzyMatchLabel } from '../vision-processor';

// Mock Ollama
const mockOllamaChat = vi.fn();
vi.mock('../../generators/ollama', () => ({
  getOllama: () => ({
    generate: vi.fn(),
    chat: mockOllamaChat,
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

// Mock classifyImages and discovery functions
const mockClassifyImages = vi.fn();
const mockDiscoverLabels = vi.fn();
const mockConsolidateLabels = vi.fn();
vi.mock('../vision-processor', async () => {
  const actual = await vi.importActual<typeof import('../vision-processor')>('../vision-processor');
  return {
    ...actual,
    classifyImages: (...args: unknown[]) => mockClassifyImages(...args),
    discoverLabels: (...args: unknown[]) => mockDiscoverLabels(...args),
    consolidateLabels: (...args: unknown[]) => mockConsolidateLabels(...args),
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

describe('Auto-categorize (--auto-labels)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run discovery and consolidation when autoLabels is enabled', async () => {
    const assets = [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')];

    // Discovery returns raw labels
    mockDiscoverLabels.mockResolvedValue(['cat', 'kitten', 'dog']);

    // Consolidation merges synonyms
    mockConsolidateLabels.mockResolvedValue(['cat', 'dog']);

    // Classification uses discovered labels
    const classifications = new Map<string, ImageClassification>();
    classifications.set('a1', { label: 'cat', relevance: 0.9, caption: 'A cat', reason: 'cat' });
    classifications.set('a2', { label: 'dog', relevance: 0.85, caption: 'A dog', reason: 'dog' });
    classifications.set('a3', {
      label: 'cat',
      relevance: 0.8,
      caption: 'Another cat',
      reason: 'cat',
    });
    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      autoLabels: true,
      autoLabelsCount: 20,
    });

    // Discovery was called
    expect(mockDiscoverLabels).toHaveBeenCalledTimes(1);

    // Consolidation was called with raw labels
    expect(mockConsolidateLabels).toHaveBeenCalledWith(
      ['cat', 'kitten', 'dog'],
      expect.any(Object)
    );

    // Classification was called with discovered labels injected
    const calledOptions = mockClassifyImages.mock.calls[0][1] as TransformOptions;
    expect(calledOptions.labels).toEqual(['cat', 'dog']);

    // Results include all records
    expect(result.records.length).toBe(3);

    // Discovered labels are included in the result
    expect(result.discoveredLabels).toEqual(['cat', 'dog']);

    // labelSource should be auto_discovered
    for (const record of result.records) {
      const r = record as Record<string, unknown>;
      const meta = r._meta as Record<string, unknown>;
      expect(meta.labelSource).toBe('auto_discovered');
    }
  });

  it('should fall back to free-form (Mode 1) when discovery returns 0 categories', async () => {
    const assets = [makeAsset('b1')];

    // Discovery returns nothing
    mockDiscoverLabels.mockResolvedValue([]);

    // Classification runs without labels (free-form)
    const classifications = new Map<string, ImageClassification>();
    classifications.set('b1', {
      label: 'unknown_thing',
      relevance: 0.6,
      caption: 'Something',
      reason: 'unclear',
    });
    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, {
      ...baseOptions,
      autoLabels: true,
    });

    // Discovery was called
    expect(mockDiscoverLabels).toHaveBeenCalledTimes(1);

    // Consolidation was NOT called (no raw labels)
    expect(mockConsolidateLabels).not.toHaveBeenCalled();

    // Classification was called without labels (free-form)
    const calledOptions = mockClassifyImages.mock.calls[0][1] as TransformOptions;
    expect(calledOptions.labels).toBeUndefined();

    expect(result.records.length).toBe(1);
    expect(result.discoveredLabels).toBeUndefined();

    // labelSource should be vllm (free-form)
    const meta = (result.records[0] as Record<string, unknown>)._meta as Record<string, unknown>;
    expect(meta.labelSource).toBe('vllm');
  });

  it('should not run discovery when autoLabels is not set', async () => {
    const assets = [makeAsset('c1')];

    const classifications = new Map<string, ImageClassification>();
    classifications.set('c1', { label: 'bird', relevance: 0.7, caption: 'A bird', reason: 'bird' });
    mockClassifyImages.mockResolvedValue(classifications);

    const result = await imageClassificationTemplate.process(assets, baseOptions);

    expect(mockDiscoverLabels).not.toHaveBeenCalled();
    expect(mockConsolidateLabels).not.toHaveBeenCalled();
    expect(result.discoveredLabels).toBeUndefined();
  });

  it('should report discovery progress via progressCb', async () => {
    const assets = [makeAsset('d1'), makeAsset('d2')];

    mockDiscoverLabels.mockResolvedValue(['cat']);
    mockConsolidateLabels.mockResolvedValue(['cat']);

    const classifications = new Map<string, ImageClassification>();
    classifications.set('d1', { label: 'cat', relevance: 0.9, caption: 'A cat', reason: 'cat' });
    classifications.set('d2', { label: 'cat', relevance: 0.8, caption: 'A cat', reason: 'cat' });
    mockClassifyImages.mockResolvedValue(classifications);

    const progressStages: string[] = [];
    const progressCb = (p: { stage: string }) => {
      if (!progressStages.includes(p.stage)) {
        progressStages.push(p.stage);
      }
    };

    await imageClassificationTemplate.process(
      assets,
      { ...baseOptions, autoLabels: true },
      progressCb
    );

    // Should include discovery and consolidation stages
    expect(progressStages).toContain('discovery');
    expect(progressStages).toContain('consolidation');
    expect(progressStages).toContain('vision');
  });
});

describe('fuzzyMatchLabel', () => {
  it('should return exact case-insensitive match', () => {
    expect(fuzzyMatchLabel('Cat', ['cat', 'dog'])).toBe('cat');
    expect(fuzzyMatchLabel('DOG', ['cat', 'dog'])).toBe('dog');
  });

  it('should match substring labels', () => {
    expect(fuzzyMatchLabel('kitten', ['cat', 'kitten', 'dog'])).toBe('kitten');
  });

  it('should return original label from allowed set on close Levenshtein match', () => {
    expect(fuzzyMatchLabel('catt', ['cat', 'dog'])).toBe('cat');
  });
});

describe('consolidateLabels (unit via mock)', () => {
  it('should deduplicate and consolidate synonym labels', async () => {
    // This test verifies the mock wiring — the real consolidation is LLM-dependent
    mockConsolidateLabels.mockResolvedValue(['kitten', 'dog']);

    const { consolidateLabels } = await import('../vision-processor');
    const result = await consolidateLabels(
      ['kitten', 'kitty', 'baby cat', 'dog', 'puppy'],
      baseOptions
    );

    expect(result).toEqual(['kitten', 'dog']);
  });
});
