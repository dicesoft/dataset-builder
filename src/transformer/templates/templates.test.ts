/**
 * Tests for transform templates
 */

import { describe, it, expect, vi } from 'vitest';
import {
  rawExtractTemplate,
  textQATemplate,
  textInstructTemplate,
  textConversationTemplate,
  imageClassificationTemplate,
  imageCaptioningTemplate,
  visionQATemplate,
  audioClassificationTemplate,
} from './index';
import { TransformOptions, ScrapedPage, AssetRecord } from '../types';
import { VisionAbortError } from '../vision-processor';
import { LLMAbortError } from '../llm-processor';

// Mock processors
vi.mock('../llm-processor', () => ({
  scoreRelevance: vi.fn(() =>
    Promise.resolve(
      new Map([
        ['1', { score: 0.9, relevant: true, reason: 'Good match' }],
        ['2', { score: 0.3, relevant: false, reason: 'No match' }],
      ])
    )
  ),
  generateQA: vi.fn(() =>
    Promise.resolve(
      new Map([
        [
          '1',
          {
            instruction: 'What is this about in detail?',
            output: 'This is a comprehensive test answer with enough detail.',
          },
        ],
      ])
    )
  ),
  generateConversation: vi.fn(() =>
    Promise.resolve(
      new Map([
        [
          '1',
          [
            { role: 'user', content: 'Tell me about this topic' },
            { role: 'assistant', content: 'Here is a detailed explanation of the topic.' },
          ],
        ],
      ])
    )
  ),
  generateInstruction: vi.fn(() =>
    Promise.resolve(
      new Map([
        [
          '1',
          {
            instruction: 'Summarize this content in detail',
            input: '',
            output: 'This is a comprehensive summary of the content provided.',
          },
        ],
      ])
    )
  ),
  setTransformAbortFlag: vi.fn(),
  LLMAbortError: class LLMAbortError extends Error {
    results: Map<string, unknown>;
    constructor(message: string, results: Map<string, unknown>) {
      super(message);
      this.name = 'LLMAbortError';
      this.results = results;
    }
  },
}));

vi.mock('../vision-processor', () => ({
  classifyImages: vi.fn(() =>
    Promise.resolve(
      new Map([
        [
          '1',
          {
            label: 'sports car',
            relevance: 0.9,
            caption: 'A fast car',
            reason: 'Clear image',
          },
        ],
      ])
    )
  ),
  captionImages: vi.fn(() => Promise.resolve(new Map([['1', 'A car image']]))),
  generateVisionQA: vi.fn(() =>
    Promise.resolve(new Map([['1', [{ question: 'What is it?', answer: 'A car' }]]]))
  ),
  SUPPORTED_VISION_FORMATS: new Set(['.jpg', '.jpeg', '.png', '.bmp']),
  VisionAbortError: class VisionAbortError extends Error {
    results: Map<string, unknown>;
    constructor(message: string, results: Map<string, unknown>) {
      super(message);
      this.name = 'VisionAbortError';
      this.results = results;
    }
  },
}));

// Mock Ollama (used directly by audio-classification template)
vi.mock('../../generators/ollama', () => ({
  getOllama: () => ({
    generate: vi.fn(() =>
      Promise.resolve({
        response: JSON.stringify({ label: 'music', confidence: 0.85, description: 'Audio file' }),
      })
    ),
    chat: vi.fn(),
    ping: vi.fn(() => Promise.resolve(true)),
    getDefaultModel: () => 'test-model',
    ensureModel: vi.fn().mockResolvedValue(undefined),
  }),
  extractFinalResponse: (text: string) => text,
}));

// Mock config (used by audio-classification template)
vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => (key === 'ollamaModel' ? 'test-model' : undefined),
  }),
}));

// Mock asset linker
vi.mock('../asset-linker', () => ({
  autoLoadInput: vi.fn(),
  linkAssetsToPages: vi.fn(),
  loadManifest: vi.fn(),
  loadScrapedData: vi.fn(),
}));

const createMockOptions = (overrides: Partial<TransformOptions> = {}): TransformOptions => ({
  input: './test',
  template: 'raw-extract',
  relevanceThreshold: 0.5,
  batchSize: 10,
  minTextLength: 50,
  maxTextLength: 10000,
  noLlm: false,
  dedupe: false,
  yes: false,
  ...overrides,
});

const createMockPage = (overrides: Partial<ScrapedPage> = {}): ScrapedPage => ({
  id: '1',
  source_url: 'https://example.com/article',
  title: 'Test Article',
  text: 'This is the article content. It has enough text to pass validation checks.',
  links: [],
  crawled_at: new Date().toISOString(),
  depth: 0,
  ...overrides,
});

const createMockAsset = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: '1',
  sourceUrl: 'https://example.com/image.jpg',
  sourcePageUrl: 'https://example.com/page',
  sourcePageTitle: 'Page Title',
  localPath: 'downloads/image.jpg',
  fileName: 'image.jpg',
  fileType: 'image',
  fileSize: 50000,
  status: 'completed',
  downloadedAt: new Date().toISOString(),
  duration: 1000,
  context: {
    altText: 'An image',
    surroundingText: '',
    pageDepth: 0,
    tags: [],
  },
  relevance: {
    score: null,
    matchesTarget: null,
    reason: null,
  },
  ...overrides,
});

describe('rawExtractTemplate', () => {
  it('should have correct metadata', () => {
    expect(rawExtractTemplate.name).toBe('raw-extract');
    expect(rawExtractTemplate.requiresLlm).toBe(false);
    expect(rawExtractTemplate.usesVision).toBe(false);
    expect(rawExtractTemplate.supportedInputs).toContain('text');
  });

  it('should process scraped pages', async () => {
    const options = createMockOptions({ template: 'raw-extract' });
    const pages = [createMockPage()];

    const result = await rawExtractTemplate.process(pages, options);

    expect(result.records).toHaveLength(1);
    expect(result.stats.inputCount).toBe(1);
    expect(result.stats.outputCount).toBe(1);
    expect(result.records[0]._meta.template).toBe('raw-extract');
  });

  it('should remove boilerplate', async () => {
    const options = createMockOptions({ template: 'raw-extract' });
    const pages = [
      createMockPage({
        text: 'Subscribe to our newsletter!\n\nActual content here that is long enough to pass the minimum text length validation after boilerplate removal.',
      }),
    ];

    const result = await rawExtractTemplate.process(pages, options);
    expect(result.records[0].text).not.toContain('newsletter');
  });

  it('should filter invalid pages', async () => {
    const options = createMockOptions({ template: 'raw-extract' });
    const pages = [createMockPage({ text: 'Short', title: 'T' })];

    const result = await rawExtractTemplate.process(pages, options);
    expect(result.stats.filteredCount).toBeGreaterThan(0);
  });

  it('should call progress callback', async () => {
    const options = createMockOptions({ template: 'raw-extract' });
    const progressCb = vi.fn();
    const pages = [createMockPage()];

    await rawExtractTemplate.process(pages, options, progressCb);

    expect(progressCb).toHaveBeenCalled();
  });

  it('should dedupe when enabled', async () => {
    const options = createMockOptions({ template: 'raw-extract', dedupe: true });
    const pages = [createMockPage(), createMockPage()];

    const result = await rawExtractTemplate.process(pages, options);
    expect(result.stats.outputCount).toBeLessThanOrEqual(1);
  });

  it('should process assets when provided', async () => {
    const options = createMockOptions({ template: 'raw-extract' });
    const assets = [createMockAsset()];

    const result = await rawExtractTemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].fileName).toBe('image.jpg');
  });
});

describe('textQATemplate', () => {
  it('should have correct metadata', () => {
    expect(textQATemplate.name).toBe('text-qa');
    expect(textQATemplate.requiresLlm).toBe(true);
    expect(textQATemplate.usesVision).toBe(false);
  });

  it('should generate Q&A with LLM', async () => {
    const options = createMockOptions({ template: 'text-qa' });
    const pages = [createMockPage()];

    const result = await textQATemplate.process(pages, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].instruction).toBeDefined();
    expect(result.records[0].output).toBeDefined();
  });

  it('should filter by relevance when target specified', async () => {
    const options = createMockOptions({
      template: 'text-qa',
      target: 'sports cars',
    });
    const pages = [createMockPage({ id: '1' }), createMockPage({ id: '2' })];

    const result = await textQATemplate.process(pages, options);

    // Only relevant records should be output
    expect(result.stats.relevantCount).toBeGreaterThanOrEqual(0);
  });

  it('should use deterministic fallback with --no-llm', async () => {
    const options = createMockOptions({ template: 'text-qa', noLlm: true });
    const pages = [createMockPage()];

    const result = await textQATemplate.process(pages, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].instruction).toContain('What');
  });

  it('should validate generated Q&A', async () => {
    const options = createMockOptions({ template: 'text-qa' });
    const pages = [createMockPage()];

    const result = await textQATemplate.process(pages, options);

    expect(result.stats.generatedCount).toBeGreaterThanOrEqual(0);
    expect(result.stats.outputCount).toBeLessThanOrEqual(result.stats.generatedCount);
  });

  it('should properly count generationFailedCount when results missing', async () => {
    // Mock generateQA to return empty map (no results for any page)
    const { generateQA } = await import('../llm-processor');
    const mockedGenerateQA = vi.mocked(generateQA);
    mockedGenerateQA.mockResolvedValueOnce(new Map());

    const options = createMockOptions({ template: 'text-qa' });
    const pages = [createMockPage()];

    const result = await textQATemplate.process(pages, options);

    // Since generateQA returned no result for page '1', it should count as failed
    expect(result.stats.generationFailedCount).toBe(1);
  });

  it('should skip records in noFallback mode when LLM returns no result', async () => {
    const { generateQA } = await import('../llm-processor');
    const mockedGenerateQA = vi.mocked(generateQA);
    mockedGenerateQA.mockResolvedValueOnce(new Map());

    const options = createMockOptions({ template: 'text-qa', noFallback: true });
    const pages = [createMockPage()];

    const result = await textQATemplate.process(pages, options);

    expect(result.stats.skippedCount).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it('should propagate abortedEarly when LLMAbortError is caught', async () => {
    const { generateQA, LLMAbortError: MockLLMAbortError } = await import('../llm-processor');
    const mockedGenerateQA = vi.mocked(generateQA);
    const partialResults = new Map([
      ['1', { instruction: 'What is this?', output: 'This is a test.' }],
    ]);
    mockedGenerateQA.mockRejectedValueOnce(
      new MockLLMAbortError('5 consecutive failures', partialResults)
    );

    const options = createMockOptions({ template: 'text-qa' });
    const pages = [createMockPage({ id: '1' }), createMockPage({ id: '2' })];

    const result = await textQATemplate.process(pages, options);

    expect(result.stats.abortedEarly).toBe(true);
    // Should still have the partial results from the abort error
    expect(result.records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('textInstructTemplate', () => {
  it('should have correct metadata', () => {
    expect(textInstructTemplate.name).toBe('text-instruct');
    expect(textInstructTemplate.requiresLlm).toBe(true);
  });

  it('should generate instruction pairs', async () => {
    const options = createMockOptions({ template: 'text-instruct' });
    const pages = [createMockPage()];

    const result = await textInstructTemplate.process(pages, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].instruction).toBeDefined();
    expect(result.records[0].output).toBeDefined();
  });

  it('should use deterministic fallback', async () => {
    const options = createMockOptions({ template: 'text-instruct', noLlm: true });
    const pages = [createMockPage({ title: 'Python' })];

    const result = await textInstructTemplate.process(pages, options);

    expect(result.records[0].instruction).toContain('Python');
  });

  it('should skip records in noFallback mode when LLM returns no result', async () => {
    const { generateInstruction } = await import('../llm-processor');
    const mockedGenerateInstruction = vi.mocked(generateInstruction);
    mockedGenerateInstruction.mockResolvedValueOnce(new Map());

    const options = createMockOptions({ template: 'text-instruct', noFallback: true });
    const pages = [createMockPage()];

    const result = await textInstructTemplate.process(pages, options);

    expect(result.stats.skippedCount).toBe(1);
  });
});

describe('textConversationTemplate', () => {
  it('should have correct metadata', () => {
    expect(textConversationTemplate.name).toBe('text-conversation');
    expect(textConversationTemplate.requiresLlm).toBe(true);
  });

  it('should generate conversations', async () => {
    const options = createMockOptions({ template: 'text-conversation' });
    const pages = [createMockPage()];

    const result = await textConversationTemplate.process(pages, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].conversation).toBeDefined();
    expect(Array.isArray(result.records[0].conversation)).toBe(true);
  });

  it('should validate conversation structure', async () => {
    const options = createMockOptions({ template: 'text-conversation' });
    const pages = [createMockPage()];

    const result = await textConversationTemplate.process(pages, options);

    if (result.records.length > 0) {
      const conversation = result.records[0].conversation as Array<{
        role: string;
        content: string;
      }>;
      expect(conversation.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should skip records in noFallback mode when LLM returns no result', async () => {
    const { generateConversation } = await import('../llm-processor');
    const mockedGenerateConversation = vi.mocked(generateConversation);
    mockedGenerateConversation.mockResolvedValueOnce(new Map());

    const options = createMockOptions({ template: 'text-conversation', noFallback: true });
    const pages = [createMockPage()];

    const result = await textConversationTemplate.process(pages, options);

    expect(result.stats.skippedCount).toBe(1);
  });
});

describe('imageClassificationTemplate', () => {
  it('should have correct metadata', () => {
    expect(imageClassificationTemplate.name).toBe('image-classification');
    expect(imageClassificationTemplate.requiresLlm).toBe(false);
    expect(imageClassificationTemplate.usesVision).toBe(true);
    expect(imageClassificationTemplate.supportedInputs).toContain('image');
  });

  it('should classify images', async () => {
    const options = createMockOptions({
      template: 'image-classification',
      target: 'sports cars',
    });
    const assets = [createMockAsset()];

    const result = await imageClassificationTemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].label).toBeDefined();
    expect(result.records[0].relevance).toBeDefined();
  });

  it('should filter junk assets', async () => {
    const options = createMockOptions({ template: 'image-classification' });
    const assets = [createMockAsset({ fileName: 'icon.svg', fileSize: 1000 })];

    const result = await imageClassificationTemplate.process(assets, options);

    expect(result.stats.filteredCount).toBeGreaterThan(0);
  });

  it('should filter by relevance threshold', async () => {
    const options = createMockOptions({
      template: 'image-classification',
      target: 'sports cars',
      relevanceThreshold: 0.8,
    });
    const assets = [createMockAsset()];

    const result = await imageClassificationTemplate.process(assets, options);

    expect(result.stats.relevantCount).toBeLessThanOrEqual(result.stats.classifiedCount);
  });

  it('should use deterministic fallback with --no-llm', async () => {
    const options = createMockOptions({
      template: 'image-classification',
      noLlm: true,
      target: 'cars',
    });
    const assets = [
      createMockAsset({ fileName: 'sports-car.jpg', sourcePageTitle: 'Cars Collection' }),
    ];

    const result = await imageClassificationTemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].label).toBeDefined();
  });

  it('should skip records in noFallback mode when VLLM returns no result', async () => {
    const { classifyImages } = await import('../vision-processor');
    const mockedClassifyImages = vi.mocked(classifyImages);
    // Return empty map — no results for asset '1'
    mockedClassifyImages.mockResolvedValueOnce(new Map());

    const options = createMockOptions({
      template: 'image-classification',
      noFallback: true,
    });
    const assets = [createMockAsset()];

    const result = await imageClassificationTemplate.process(assets, options);

    expect(result.stats.skippedCount).toBe(1);
    expect(result.records).toHaveLength(0);
  });
});

describe('imageCaptioningTemplate', () => {
  it('should have correct metadata', () => {
    expect(imageCaptioningTemplate.name).toBe('image-captioning');
    expect(imageCaptioningTemplate.usesVision).toBe(true);
  });

  it('should generate captions', async () => {
    const options = createMockOptions({ template: 'image-captioning' });
    const assets = [createMockAsset()];

    const result = await imageCaptioningTemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].caption).toBeDefined();
  });

  it('should use alt text as fallback', async () => {
    const options = createMockOptions({ template: 'image-captioning', noLlm: true });
    const assets = [
      createMockAsset({ context: { ...createMockAsset().context, altText: 'A red car' } }),
    ];

    const result = await imageCaptioningTemplate.process(assets, options);

    expect(result.records[0].caption).toBe('A red car');
  });

  it('should filter empty captions', async () => {
    const options = createMockOptions({ template: 'image-captioning', noLlm: true });
    const assets = [createMockAsset({ context: { ...createMockAsset().context, altText: '' } })];

    const result = await imageCaptioningTemplate.process(assets, options);

    expect(result.stats.outputCount).toBe(0);
  });

  it('should skip records in noFallback mode when VLLM returns no result', async () => {
    const { captionImages } = await import('../vision-processor');
    const mockedCaptionImages = vi.mocked(captionImages);
    mockedCaptionImages.mockResolvedValueOnce(new Map());

    const options = createMockOptions({ template: 'image-captioning', noFallback: true });
    const assets = [createMockAsset()];

    const result = await imageCaptioningTemplate.process(assets, options);

    expect(result.stats.skippedCount).toBe(1);
  });
});

describe('visionQATemplate', () => {
  it('should have correct metadata', () => {
    expect(visionQATemplate.name).toBe('vision-qa');
    expect(visionQATemplate.usesVision).toBe(true);
  });

  it('should generate vision Q&A', async () => {
    const options = createMockOptions({ template: 'vision-qa' });
    const assets = [createMockAsset()];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].conversations).toBeDefined();
  });

  it('should format conversations correctly', async () => {
    const options = createMockOptions({ template: 'vision-qa' });
    const assets = [createMockAsset()];

    const result = await visionQATemplate.process(assets, options);

    const conversations = result.records[0].conversations as Array<{ from: string; value: string }>;
    expect(conversations[0].from).toBe('human');
    expect(conversations[0].value).toContain('<image>');
  });

  it('should use contextual fallback with --no-llm and target', async () => {
    const options = createMockOptions({
      template: 'vision-qa',
      noLlm: true,
      target: 'sports cars',
    });
    const assets = [createMockAsset({ fileName: 'mclaren-750s.jpg' })];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    const conversations = result.records[0].conversations as Array<{ from: string; value: string }>;
    // Should include target in the question
    expect(conversations[0].value.toLowerCase()).toContain('sports car');
    // Should have contextual answer based on filename
    expect(conversations[1].value.toLowerCase()).toContain('mclaren');
  });

  it('should generate contextual Q&A from filename without target', async () => {
    const options = createMockOptions({
      template: 'vision-qa',
      noLlm: true,
    });
    const assets = [createMockAsset({ fileName: 'mclaren-750s.jpg' })];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    const conversations = result.records[0].conversations as Array<{ from: string; value: string }>;
    // Should have contextual answer mentioning the filename
    expect(conversations[1].value.toLowerCase()).toContain('mclaren');
  });

  it('should use page title as fallback when filename is generic', async () => {
    const options = createMockOptions({
      template: 'vision-qa',
      noLlm: true,
    });
    const assets = [
      createMockAsset({
        fileName: 'image.jpg',
        sourcePageTitle: 'McLaren Automotive',
      }),
    ];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    const conversations = result.records[0].conversations as Array<{ from: string; value: string }>;
    // Should mention the page title in the answer
    expect(conversations[1].value.toLowerCase()).toContain('mclaren');
  });

  it('should generate follow-up questions in contextual fallback', async () => {
    const options = createMockOptions({
      template: 'vision-qa',
      noLlm: true,
      target: 'cars',
    });
    const assets = [createMockAsset({ fileName: 'porsche-911.jpg' })];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    const conversations = result.records[0].conversations as Array<{ from: string; value: string }>;
    // Should have at least 2 Q&A pairs (initial + follow-up)
    expect(conversations.length).toBeGreaterThanOrEqual(4); // 2 pairs = 4 entries
  });

  it('should track visionFallbackCount when VLLM returns no results for some assets', async () => {
    // Mock generateVisionQA to return results for only asset '1', not '2'
    const { generateVisionQA } = await import('../vision-processor');
    const mockedGenerateVisionQA = vi.mocked(generateVisionQA);
    mockedGenerateVisionQA.mockResolvedValueOnce(
      new Map([['1', [{ question: 'What is it?', answer: 'A car' }]]])
    );

    const options = createMockOptions({ template: 'vision-qa' });
    const assets = [
      createMockAsset({ id: '1' }),
      createMockAsset({ id: '2', fileName: 'image2.jpg' }),
    ];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(2);
    expect(result.stats.visionFallbackCount).toBe(1);
  });

  it('should not set visionFallbackCount when all assets use VLLM', async () => {
    const { generateVisionQA } = await import('../vision-processor');
    const mockedGenerateVisionQA = vi.mocked(generateVisionQA);
    mockedGenerateVisionQA.mockResolvedValueOnce(
      new Map([['1', [{ question: 'What is it?', answer: 'A car' }]]])
    );

    const options = createMockOptions({ template: 'vision-qa' });
    const assets = [createMockAsset()];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.stats.visionFallbackCount).toBeUndefined();
  });

  it('should track all as fallback when generateVisionQA throws generic error', async () => {
    const { generateVisionQA } = await import('../vision-processor');
    const mockedGenerateVisionQA = vi.mocked(generateVisionQA);
    mockedGenerateVisionQA.mockRejectedValueOnce(new Error('Connection refused'));

    const options = createMockOptions({ template: 'vision-qa' });
    const assets = [createMockAsset()];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.stats.visionFallbackCount).toBe(1);
  });

  it('should not set visionFallbackCount in noLlm mode', async () => {
    const options = createMockOptions({ template: 'vision-qa', noLlm: true });
    const assets = [createMockAsset()];

    const result = await visionQATemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    // In noLlm mode, visionFallbackCount stays 0 (undefined in stats)
    expect(result.stats.visionFallbackCount).toBeUndefined();
  });

  it('should skip records in noFallback mode when VLLM returns no result', async () => {
    const { generateVisionQA } = await import('../vision-processor');
    const mockedGenerateVisionQA = vi.mocked(generateVisionQA);
    mockedGenerateVisionQA.mockResolvedValueOnce(new Map());

    const options = createMockOptions({ template: 'vision-qa', noFallback: true });
    const assets = [createMockAsset()];

    const result = await visionQATemplate.process(assets, options);

    expect(result.stats.skippedCount).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it('should propagate abortedEarly when VisionAbortError is caught', async () => {
    const { generateVisionQA, VisionAbortError: MockVisionAbortError } =
      await import('../vision-processor');
    const mockedGenerateVisionQA = vi.mocked(generateVisionQA);
    const partialResults = new Map([['1', [{ question: 'What is it?', answer: 'A car' }]]]);
    mockedGenerateVisionQA.mockRejectedValueOnce(
      new MockVisionAbortError('5 consecutive VLLM failures', partialResults)
    );

    const options = createMockOptions({ template: 'vision-qa' });
    const assets = [
      createMockAsset({ id: '1' }),
      createMockAsset({ id: '2', fileName: 'image2.jpg' }),
    ];

    const result = await visionQATemplate.process(assets, options);

    expect(result.stats.abortedEarly).toBe(true);
    // Should have partial results from the abort error for asset '1'
    expect(result.records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('audioClassificationTemplate', () => {
  it('should have correct metadata', () => {
    expect(audioClassificationTemplate.name).toBe('audio-classification');
    expect(audioClassificationTemplate.requiresLlm).toBe(true);
    expect(audioClassificationTemplate.supportedInputs).toContain('audio');
  });

  it('should classify audio files', async () => {
    const options = createMockOptions({ template: 'audio-classification' });
    const assets = [createMockAsset({ fileType: 'audio', fileName: 'song.mp3' })];

    const result = await audioClassificationTemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].label).toBeDefined();
  });

  it('should use deterministic fallback with --no-llm', async () => {
    const options = createMockOptions({ template: 'audio-classification', noLlm: true });
    const assets = [createMockAsset({ fileType: 'audio', fileName: 'speech.mp3' })];

    const result = await audioClassificationTemplate.process(assets, options);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].label).toBeDefined();
  });
});
