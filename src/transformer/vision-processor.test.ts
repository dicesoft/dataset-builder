/**
 * Tests for vision processor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyImages,
  captionImages,
  generateVisionQA,
  VisionAbortError,
} from './vision-processor';
import { ModelNotFoundError } from '../generators/ollama';
import { TransformOptions } from './types';
import { AssetRecord } from '../downloader/types';

// Mock OllamaClient.chat() via getOllama
const mockChat = vi.fn();

vi.mock('../generators/ollama', () => {
  // Define ModelNotFoundError inside factory so it's available at hoist time
  class _ModelNotFoundError extends Error {
    public readonly modelName: string;
    constructor(modelName: string) {
      super(`Model '${modelName}' not found locally`);
      this.name = 'ModelNotFoundError';
      this.modelName = modelName;
    }
  }
  return {
    getOllama: () => ({
      chat: (...args: unknown[]) => mockChat(...args),
      ensureModel: vi.fn().mockResolvedValue(undefined),
    }),
    extractFinalResponse: (text: string) =>
      text
        .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim(),
    ModelNotFoundError: _ModelNotFoundError,
  };
});

// Mock fs/promises
const mockAccess = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('fake-image'));
vi.mock('fs/promises', () => ({
  default: {
    access: (...args: unknown[]) => mockAccess(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
  access: (...args: unknown[]) => mockAccess(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Mock config
vi.mock('../config', () => ({
  getConfig: () => ({
    get: (key: string) => (key === 'ollamaModel' ? 'test-model' : undefined),
  }),
}));

const createMockAsset = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: 'asset_0',
  sourceUrl: 'https://example.com/images/car.jpg',
  sourcePageUrl: 'https://example.com/cars',
  sourcePageTitle: 'Cars Gallery',
  localPath: 'downloads/images/car.jpg',
  fileName: 'car.jpg',
  fileType: 'image',
  fileSize: 50000,
  status: 'completed',
  downloadedAt: new Date().toISOString(),
  duration: 1000,
  context: {
    altText: 'A car',
    surroundingText: '',
    pageDepth: 0,
    tags: ['car'],
  },
  relevance: {
    score: null,
    matchesTarget: null,
    reason: null,
  },
  ...overrides,
});

describe('classifyImages', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'image-classification',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
    target: 'sports cars',
  };

  beforeEach(() => {
    mockChat.mockReset();
    (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;
  });

  it('should classify images with vision model', async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        label: 'sports car',
        relevance: 0.9,
        caption: 'A red sports car parked on the street',
        reason: 'Clear image of a sports car',
      })
    );

    const assets = [createMockAsset()];
    const results = await classifyImages(assets, options);

    const classification = results.get('asset_0');
    expect(classification?.label).toBe('sports car');
    expect(classification?.relevance).toBe(0.9);
    expect(classification?.caption).toBe('A red sports car parked on the street');
  });

  it('should handle multiple images', async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        JSON.stringify({
          label: `car ${callCount}`,
          relevance: 0.8,
          caption: `Description ${callCount}`,
          reason: 'Good image',
        })
      );
    });

    const assets = [
      createMockAsset({ id: '1', fileName: 'car1.jpg' }),
      createMockAsset({ id: '2', fileName: 'car2.jpg' }),
    ];

    const results = await classifyImages(assets, options);

    expect(results.size).toBe(2);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('should call progress callback', async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        label: 'car',
        relevance: 0.7,
        caption: 'A car',
        reason: 'Good',
      })
    );

    const progressCb = vi.fn();
    const assets = [createMockAsset()];

    await classifyImages(assets, options, progressCb);

    expect(progressCb).toHaveBeenCalled();
    expect(progressCb.mock.calls[0][0].stage).toBe('vision');
  });

  it('should not set fallback result on failure (leave undefined)', async () => {
    mockChat.mockRejectedValue(new Error('Vision model failed'));

    const assets = [createMockAsset({ localPath: 'downloads/cars/sports.jpg' })];
    const results = await classifyImages(assets, options);

    // Should NOT have a fallback result — left undefined for template to handle
    expect(results.get('asset_0')).toBeUndefined();
  });

  it('should use deterministic fallback when no-llm is set', async () => {
    const noLlmOptions = { ...options, noLlm: true };
    const assets = [createMockAsset({ localPath: 'downloads/vehicles/car.jpg' })];

    const results = await classifyImages(assets, noLlmOptions);

    expect(mockChat).not.toHaveBeenCalled();
    expect(results.get('asset_0')).toBeDefined();
  });

  it('should normalize relevance scores to 0-1 range', async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        label: 'car',
        relevance: 1.5, // Out of range
        caption: 'A car',
        reason: 'Good',
      })
    );

    const assets = [createMockAsset()];
    const results = await classifyImages(assets, options);

    expect(results.get('asset_0')?.relevance).toBe(1); // Capped at 1
  });

  it('should retry without format on empty response from thinking model', async () => {
    // First call returns empty (format + think conflict), second succeeds
    mockChat.mockResolvedValueOnce('').mockResolvedValueOnce(
      JSON.stringify({
        label: 'car',
        relevance: 0.8,
        caption: 'A car image',
        reason: 'Retried without format',
      })
    );

    const assets = [createMockAsset()];
    const results = await classifyImages(assets, options);

    expect(mockChat).toHaveBeenCalledTimes(2);
    // First call should have format, second should not
    expect(mockChat.mock.calls[0][0].format).toBeDefined();
    expect(mockChat.mock.calls[1][0].format).toBeUndefined();
    expect(results.get('asset_0')?.label).toBe('car');
  });

  it('should strip <think> tags from response before parsing', async () => {
    mockChat.mockResolvedValue(
      '<think>Let me analyze this image...</think>' +
        JSON.stringify({
          label: 'sports car',
          relevance: 0.9,
          caption: 'A red sports car',
          reason: 'Thinking model response',
        })
    );

    const assets = [createMockAsset()];
    const results = await classifyImages(assets, options);

    expect(results.get('asset_0')?.label).toBe('sports car');
  });

  it('should include failed items in progress count', async () => {
    mockChat.mockRejectedValue(new Error('Vision model failed'));

    const progressCb = vi.fn();
    const assets = [createMockAsset()];
    await classifyImages(assets, options, progressCb);

    // Progress should include the failed item
    expect(progressCb).toHaveBeenCalled();
    const lastCall = progressCb.mock.calls[progressCb.mock.calls.length - 1][0];
    expect(lastCall.completed).toBe(1); // completed + failed = 1
    expect(lastCall.message).toContain('failed');
  });

  it('should return empty results on consecutive failures in noFallback mode', async () => {
    mockChat.mockRejectedValue(new Error('Vision model down'));

    const noFallbackOptions = { ...options, noFallback: true, retries: 1 };
    const assets = Array.from({ length: 6 }, (_, i) =>
      createMockAsset({ id: `asset_${i}`, fileName: `car${i}.jpg` })
    );

    const results = await classifyImages(assets, noFallbackOptions);
    expect(results.size).toBe(0);
  });

  it('should respect configurable retries', async () => {
    mockChat.mockRejectedValue(new Error('fail'));

    const retryOptions = { ...options, retries: 1 };
    const assets = [createMockAsset()];

    await classifyImages(assets, retryOptions);

    // With retries=1, classifySingleImage should only attempt once
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('should return partial results on abort instead of throwing', async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = true;
      }
      return Promise.resolve(
        JSON.stringify({
          label: `car ${callCount}`,
          relevance: 0.8,
          caption: `Car ${callCount}`,
          reason: 'Good',
        })
      );
    });

    const assets = [
      createMockAsset({ id: '1' }),
      createMockAsset({ id: '2' }),
      createMockAsset({ id: '3' }),
    ];

    // Should NOT throw, should return partial results
    const results = await classifyImages(assets, options);
    expect(results.size).toBeGreaterThanOrEqual(1);
    expect(results.size).toBeLessThan(3);
  });
});

describe('captionImages', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'image-captioning',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockChat.mockReset();
    (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;
  });

  it('should generate captions for images', async () => {
    mockChat.mockResolvedValue('A beautiful sunset over the ocean with sailboats in the distance');

    const assets = [createMockAsset({ context: { ...createMockAsset().context, altText: null } })];
    const results = await captionImages(assets, options);

    expect(results.get('asset_0')).toBe(
      'A beautiful sunset over the ocean with sailboats in the distance'
    );
  });

  it('should use alt text as fallback when no-llm', async () => {
    const noLlmOptions = { ...options, noLlm: true };
    const assets = [
      createMockAsset({ context: { ...createMockAsset().context, altText: 'A red car' } }),
    ];

    const results = await captionImages(assets, noLlmOptions);

    expect(results.get('asset_0')).toBe('A red car');
  });

  it('should use page title as fallback when no alt text', async () => {
    const noLlmOptions = { ...options, noLlm: true };
    const assets = [
      createMockAsset({
        context: { ...createMockAsset().context, altText: null },
        sourcePageTitle: 'Car Gallery',
      }),
    ];

    const results = await captionImages(assets, noLlmOptions);

    expect(results.get('asset_0')).toContain('Car Gallery');
  });

  it('should not set fallback result on vision model failure', async () => {
    mockChat.mockRejectedValue(new Error('Model error'));

    const assets = [createMockAsset({ sourcePageTitle: 'Test Page' })];
    const results = await captionImages(assets, options);

    // Should NOT have a fallback — undefined for the template to handle
    expect(results.get('asset_0')).toBeUndefined();
  });

  it('should report progress', async () => {
    mockChat.mockResolvedValue('A caption');

    const progressCb = vi.fn();
    const assets = [createMockAsset()];

    await captionImages(assets, options, progressCb);

    expect(progressCb).toHaveBeenCalled();
  });

  it('should strip <think> tags from caption response', async () => {
    mockChat.mockResolvedValue(
      '<think>Analyzing the image contents...</think>A red sports car on a highway'
    );

    const assets = [createMockAsset()];
    const results = await captionImages(assets, options);

    expect(results.get('asset_0')).toBe('A red sports car on a highway');
  });

  it('should include failed items in progress count', async () => {
    mockChat.mockRejectedValue(new Error('fail'));

    const progressCb = vi.fn();
    const assets = [createMockAsset()];
    await captionImages(assets, options, progressCb);

    const lastCall = progressCb.mock.calls[progressCb.mock.calls.length - 1][0];
    expect(lastCall.completed).toBe(1); // completed + failed = 1
    expect(lastCall.message).toContain('failed');
  });
});

describe('generateVisionQA', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'vision-qa',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockChat.mockReset();
    (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;
  });

  it('should generate Q&A pairs for images', async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        qa_pairs: [
          { question: 'What color is the car?', answer: 'The car is red.' },
          { question: 'What type of car is it?', answer: 'It is a sports car.' },
        ],
      })
    );

    const assets = [createMockAsset()];
    const results = await generateVisionQA(assets, options);

    const qa = results.get('asset_0');
    expect(qa).toHaveLength(2);
    expect(qa?.[0].question).toBe('What color is the car?');
    expect(qa?.[0].answer).toBe('The car is red.');
  });

  it('should use fallback when no-llm', async () => {
    const noLlmOptions = { ...options, noLlm: true };
    const assets = [createMockAsset({ sourcePageTitle: 'Car Gallery' })];

    const results = await generateVisionQA(assets, noLlmOptions);

    const qa = results.get('asset_0');
    expect(qa).toBeDefined();
    expect(qa?.length).toBeGreaterThanOrEqual(1);
  });

  it('should not set fallback result on malformed JSON', async () => {
    // malformed JSON should trigger retries then fail (no fallback in processor)
    mockChat.mockResolvedValue('invalid json');

    const assets = [createMockAsset({ sourcePageTitle: 'Car Gallery' })];
    const results = await generateVisionQA(assets, options);

    // No fallback — left undefined for the template to handle
    expect(results.get('asset_0')).toBeUndefined();
  });

  it('should not set fallback result on failure', async () => {
    mockChat.mockRejectedValue(new Error('Failed'));

    const assets = [createMockAsset({ sourcePageTitle: 'Car Gallery' })];
    const results = await generateVisionQA(assets, options);

    // No fallback — left undefined
    expect(results.get('asset_0')).toBeUndefined();
  });

  it('should report progress', async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        qa_pairs: [{ question: 'Q1', answer: 'A1' }],
      })
    );

    const progressCb = vi.fn();
    const assets = [createMockAsset()];

    await generateVisionQA(assets, options, progressCb);

    expect(progressCb).toHaveBeenCalled();
  });

  it('should retry without format on empty response from thinking model', async () => {
    // First call returns empty, second succeeds without format
    mockChat.mockResolvedValueOnce('').mockResolvedValueOnce(
      JSON.stringify({
        qa_pairs: [{ question: 'What is this?', answer: 'A car.' }],
      })
    );

    const assets = [createMockAsset()];
    const results = await generateVisionQA(assets, options);

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockChat.mock.calls[0][0].format).toBeDefined();
    expect(mockChat.mock.calls[1][0].format).toBeUndefined();
    expect(results.get('asset_0')?.[0].question).toBe('What is this?');
  });

  it('should strip <think> tags from response before parsing JSON', async () => {
    mockChat.mockResolvedValue(
      '<think>Let me generate some QA pairs...</think>' +
        JSON.stringify({
          qa_pairs: [{ question: 'What color?', answer: 'Red.' }],
        })
    );

    const assets = [createMockAsset()];
    const results = await generateVisionQA(assets, options);

    expect(results.get('asset_0')?.[0].question).toBe('What color?');
  });

  it('should extract JSON from markdown code blocks', async () => {
    mockChat.mockResolvedValue(
      '```json\n' +
        JSON.stringify({
          qa_pairs: [{ question: 'What is shown?', answer: 'A car.' }],
        }) +
        '\n```'
    );

    const assets = [createMockAsset()];
    const results = await generateVisionQA(assets, options);

    expect(results.get('asset_0')?.[0].question).toBe('What is shown?');
  });

  it('should return empty results on consecutive failures in noFallback mode', async () => {
    mockChat.mockRejectedValue(new Error('VLLM down'));

    const noFallbackOptions = { ...options, noFallback: true, retries: 1 };
    const assets = Array.from({ length: 6 }, (_, i) =>
      createMockAsset({ id: `asset_${i}`, fileName: `img${i}.jpg` })
    );

    const results = await generateVisionQA(assets, noFallbackOptions);
    expect(results.size).toBe(0);
  });

  it('should return partial results on abort', async () => {
    let callCount = 0;
    mockChat.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = true;
      }
      return Promise.resolve(
        JSON.stringify({
          qa_pairs: [{ question: `Q${callCount}`, answer: `A${callCount}` }],
        })
      );
    });

    const assets = [
      createMockAsset({ id: '1' }),
      createMockAsset({ id: '2' }),
      createMockAsset({ id: '3' }),
    ];

    const results = await generateVisionQA(assets, options);
    expect(results.size).toBeGreaterThanOrEqual(1);
    expect(results.size).toBeLessThan(3);
  });
});

describe('image path resolution', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockAccess.mockClear();
    mockAccess.mockResolvedValue(undefined);
    (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;
  });

  it('should resolve image paths relative to assetDir for captionImages', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // Enable fs.access check
    try {
      const assets = [createMockAsset({ localPath: 'downloads/images/car.jpg' })];
      const options: TransformOptions = {
        input: '/data/task_789/scraped_combined.json',
        template: 'image-captioning',
        assetDir: '/data/task_789',
        relevanceThreshold: 0.5,
        batchSize: 2,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: false,
      };

      await captionImages(assets, options);

      expect(mockAccess).toHaveBeenCalled();
      const accessedPath = mockAccess.mock.calls[0][0] as string;
      // Path should be resolved relative to assetDir, not CWD
      expect(accessedPath).toContain('task_789');
      expect(accessedPath).toContain('downloads');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('should fall back to input dirname when assetDir is not set for captionImages', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // Enable fs.access check
    try {
      const assets = [createMockAsset({ localPath: 'downloads/images/car.jpg' })];
      const options: TransformOptions = {
        input: '/data/task_456/scraped_combined.json',
        template: 'image-captioning',
        relevanceThreshold: 0.5,
        batchSize: 2,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: false,
      };

      await captionImages(assets, options);

      expect(mockAccess).toHaveBeenCalled();
      const accessedPath = mockAccess.mock.calls[0][0] as string;
      // Should resolve relative to dirname of input (/data/task_456)
      expect(accessedPath).toContain('task_456');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('should resolve image paths relative to assetDir for generateVisionQA', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // Enable fs.access check
    try {
      const assets = [createMockAsset({ localPath: 'downloads/images/car.jpg' })];
      const options: TransformOptions = {
        input: '/data/task_101/scraped_combined.json',
        template: 'vision-qa',
        assetDir: '/data/task_101',
        relevanceThreshold: 0.5,
        batchSize: 2,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: false,
      };

      await generateVisionQA(assets, options);

      expect(mockAccess).toHaveBeenCalled();
      const accessedPath = mockAccess.mock.calls[0][0] as string;
      expect(accessedPath).toContain('task_101');
      expect(accessedPath).toContain('downloads');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

describe('ModelNotFoundError - no retry', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'image-classification',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
    target: 'sports cars',
  };

  beforeEach(() => {
    mockChat.mockReset();
    (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;
  });

  it('should not retry on ModelNotFoundError in classifyImages', async () => {
    mockChat.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const assets = [createMockAsset()];

    // Outer catch swallows the error per-image, but mockChat should only be called once (no retries)
    await classifyImages(assets, { ...options, retries: 3 });
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('should not retry on ModelNotFoundError in captionImages', async () => {
    mockChat.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const assets = [createMockAsset()];

    await captionImages(assets, { ...options, retries: 3 });
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('should not retry on ModelNotFoundError in generateVisionQA', async () => {
    mockChat.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const assets = [createMockAsset()];

    await generateVisionQA(assets, { ...options, retries: 3 });
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
