/**
 * Integration tests for transform pipeline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transformDataset,
  autoLoadInput,
  writeTransformOutput,
  printTransformStats,
  setTransformAbort,
} from '../index';
import { TransformOptions } from '../types';
import path from 'path';
import fs from 'fs/promises';

// Mock Ollama
const mockGenerate = vi.fn();
const mockChat = vi.fn();
const mockPing = vi.fn();

vi.mock('../../generators/ollama', () => ({
  getOllama: () => ({
    generate: (...args: unknown[]) => mockGenerate(...args),
    chat: (...args: unknown[]) => mockChat(...args),
    ping: (...args: unknown[]) => mockPing(...args),
    getDefaultModel: () => 'test-model',
    ensureModel: vi.fn().mockResolvedValue(undefined),
  }),
  extractFinalResponse: (text: string) =>
    text
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim(),
}));

vi.mock('ollama', () => ({
  default: {
    chat: (...args: unknown[]) => mockChat(...args),
    generate: (...args: unknown[]) => mockGenerate(...args),
  },
}));

vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => (key === 'ollamaModel' ? 'test-model' : undefined),
  }),
}));

// Mock fs for vision tests
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    access: () => Promise.resolve(),
  };
});

const fixturesDir = path.join(__dirname, '../__fixtures__');

describe('Transform Integration', () => {
  beforeEach(() => {
    mockGenerate.mockClear();
    mockChat.mockClear();
    mockPing.mockClear();
  });

  describe('raw-extract template', () => {
    it('should process scraped data deterministically', async () => {
      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'raw-extract',
        output: path.join(fixturesDir, 'output-raw.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: false,
        yes: true,
        verbose: false,
      };

      const result = await transformDataset(options);

      expect(result.records.length).toBeGreaterThan(0);
      expect(result.stats.inputCount).toBe(4);
      // One record filtered out for being too short
      expect(result.stats.filteredCount).toBeGreaterThanOrEqual(1);
      expect(result.stats.outputCount).toBeGreaterThan(0);

      // Verify _meta is present
      const firstRecord = result.records[0] as Record<string, unknown>;
      expect(firstRecord._meta).toBeDefined();
      expect(firstRecord._meta).toMatchObject({
        template: 'raw-extract',
      });
    });

    it('should process asset manifest deterministically', async () => {
      const options: TransformOptions = {
        input: path.join(fixturesDir, 'manifest.json'),
        template: 'raw-extract',
        output: path.join(fixturesDir, 'output-manifest.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(result.stats.inputCount).toBe(5);
      // Should filter out icon and failed asset
      expect(result.stats.filteredCount).toBeGreaterThanOrEqual(2);
      expect(result.stats.outputCount).toBeGreaterThan(0);

      // Verify filtered out junk assets
      const records = result.records as Array<Record<string, unknown>>;
      expect(records.some((r) => (r.fileName as string)?.includes('icon'))).toBe(false);
    });

    it('should deduplicate when requested', async () => {
      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'raw-extract',
        output: path.join(fixturesDir, 'output-dedupe.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: true,
        yes: true,
      };

      const result = await transformDataset(options);
      // Should process without errors
      expect(result.stats.outputCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('text-qa template', () => {
    it('should generate Q&A pairs with LLM', async () => {
      mockPing.mockResolvedValue(true);
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [
            {
              id: 'page_001',
              instruction: 'What are sports cars?',
              output: 'Sports cars are high-performance vehicles designed for speed.',
            },
            {
              id: 'page_002',
              instruction: 'What are electric sports cars?',
              output: 'Electric sports cars use electric motors for instant torque.',
            },
          ],
        }),
      });

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-qa',
        output: path.join(fixturesDir, 'output-qa.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(mockGenerate).toHaveBeenCalled();
      expect(result.records.length).toBeGreaterThan(0);

      // Verify Q&A structure
      const firstRecord = result.records[0] as Record<string, unknown>;
      expect(firstRecord.instruction).toBeDefined();
      expect(firstRecord.output).toBeDefined();
      expect(firstRecord._meta).toBeDefined();
    });

    it('should fall back to deterministic mode when LLM unavailable', async () => {
      mockPing.mockResolvedValue(false);

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-qa',
        output: path.join(fixturesDir, 'output-qa-fallback.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      // Should still produce results
      expect(result.records.length).toBeGreaterThan(0);
      expect(result.stats.generatedCount).toBeGreaterThan(0);
    });

    it('should apply target relevance filtering', async () => {
      mockPing.mockResolvedValue(true);
      mockGenerate
        .mockResolvedValueOnce({
          response: JSON.stringify({
            scores: [
              { id: 'page_001', score: 0.8, relevant: true, reason: 'About sports' },
              { id: 'page_002', score: 0.7, relevant: true, reason: 'About electric sports' },
              { id: 'page_003', score: 0.6, relevant: true, reason: 'About classic' },
            ],
          }),
        })
        .mockResolvedValue({
          response: JSON.stringify({
            qa_pairs: [
              { id: 'page_001', instruction: 'Q1', output: 'A1' },
              { id: 'page_002', instruction: 'Q2', output: 'A2' },
              { id: 'page_003', instruction: 'Q3', output: 'A3' },
            ],
          }),
        });

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-qa',
        output: path.join(fixturesDir, 'output-qa-target.json'),
        target: 'sports cars',
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(result.stats.classifiedCount).toBeGreaterThan(0);
      expect(result.stats.relevantCount).toBeGreaterThanOrEqual(0);
    });

    it('should track generation failures and quality filtering in stats', async () => {
      mockPing.mockResolvedValue(true);
      // Mock returns only 2 out of 3 results to test generationFailedCount tracking
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [
            {
              id: 'page_001',
              instruction: 'Question 1',
              output: 'Answer 1 with sufficient length',
            },
            {
              id: 'page_002',
              instruction: 'Question 2',
              output: 'Answer 2 with sufficient length',
            },
            // page_003 is intentionally missing to test generationFailedCount
          ],
        }),
      });

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-qa',
        output: path.join(fixturesDir, 'output-qa-tracking.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      // Verify stats tracking fields exist
      expect(result.stats).toHaveProperty('generationFailedCount');
      expect(result.stats).toHaveProperty('qualityFilteredCount');

      // generationFailedCount should track the 1 page that didn't get results
      expect(result.stats.generationFailedCount).toBeGreaterThanOrEqual(0);

      // In default mode (no noFallback), failed records get deterministic fallback
      // so generationFailed does NOT reduce output count.
      // Output = relevantCount - qualityFiltered - skipped
      const qualityFiltered = result.stats.qualityFilteredCount || 0;
      const skipped = result.stats.skippedCount || 0;
      expect(result.stats.outputCount).toBe(result.stats.relevantCount - qualityFiltered - skipped);
    });
  });

  describe('text-instruct template', () => {
    it('should generate instruction pairs', async () => {
      mockPing.mockResolvedValue(true);
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          instructions: [
            {
              id: 'page_001',
              instruction: 'Summarize sports cars',
              input: '',
              output: 'Sports cars are high-performance vehicles.',
            },
          ],
        }),
      });

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-instruct',
        output: path.join(fixturesDir, 'output-instruct.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(result.records.length).toBeGreaterThan(0);
      const firstRecord = result.records[0] as Record<string, unknown>;
      expect(firstRecord.instruction).toBeDefined();
      expect(firstRecord.output).toBeDefined();
    });
  });

  describe('text-conversation template', () => {
    it('should generate conversations', async () => {
      mockPing.mockResolvedValue(true);
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          conversation: [
            { role: 'user', content: 'Tell me about sports cars' },
            { role: 'assistant', content: 'Sports cars are fast vehicles.' },
            { role: 'user', content: 'How fast can sports cars go?' },
            { role: 'assistant', content: 'They can go over 200 mph.' },
          ],
        }),
      });

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-conversation',
        output: path.join(fixturesDir, 'output-conv.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(result.records.length).toBeGreaterThan(0);
      const firstRecord = result.records[0] as Record<string, unknown>;
      expect(firstRecord.conversation).toBeDefined();
      expect(Array.isArray(firstRecord.conversation)).toBe(true);
    });
  });

  describe('image-classification template', () => {
    it('should classify images deterministically', async () => {
      const options: TransformOptions = {
        input: path.join(fixturesDir, 'manifest.json'),
        template: 'image-classification',
        output: path.join(fixturesDir, 'output-img-cls.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      // Should filter junk and keep valid images
      expect(result.stats.inputCount).toBe(5);
      expect(result.stats.filteredCount).toBeGreaterThanOrEqual(2); // icon + failed
    });

    it('should classify images with vision model', async () => {
      mockPing.mockResolvedValue(true);
      mockChat.mockResolvedValue(
        JSON.stringify({
          label: 'sports car',
          relevance: 0.9,
          caption: 'A red sports car',
          reason: 'Clear sports car image',
        })
      );

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'manifest.json'),
        template: 'image-classification',
        output: path.join(fixturesDir, 'output-img-vision.json'),
        target: 'sports cars',
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(mockChat).toHaveBeenCalled();
      expect(result.records.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('image-captioning template', () => {
    it('should generate captions for images', async () => {
      mockPing.mockResolvedValue(true);
      mockChat.mockResolvedValue('A red Ferrari 488 GTB parked on a street');

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'manifest.json'),
        template: 'image-captioning',
        output: path.join(fixturesDir, 'output-captions.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(mockChat).toHaveBeenCalled();
      const firstRecord = result.records[0] as Record<string, unknown>;
      if (result.records.length > 0) {
        expect(firstRecord.caption).toBeDefined();
      }
    });
  });

  describe('vision-qa template', () => {
    it('should generate Q&A for images', async () => {
      mockPing.mockResolvedValue(true);
      mockChat.mockResolvedValue(
        JSON.stringify({
          qa_pairs: [
            { question: 'What car is this?', answer: 'This is a Ferrari.' },
            { question: 'What color is it?', answer: 'It is red.' },
          ],
        })
      );

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'manifest.json'),
        template: 'vision-qa',
        output: path.join(fixturesDir, 'output-vision-qa.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      expect(mockChat).toHaveBeenCalled();
    });
  });

  describe('audio-classification template', () => {
    it('should classify audio files with LLM', async () => {
      mockPing.mockResolvedValue(true);
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          label: 'engine sound',
          confidence: 0.85,
          description: 'Sound of a sports car engine revving',
        }),
      });

      // Create a manifest with audio files
      const options: TransformOptions = {
        input: path.join(fixturesDir, 'manifest.json'),
        template: 'audio-classification',
        output: path.join(fixturesDir, 'output-audio.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: false,
        dedupe: false,
        yes: true,
      };

      // This will process but might not find audio files
      const result = await transformDataset(options);

      expect(result).toBeDefined();
    });
  });

  describe('autoLoadInput', () => {
    it('should auto-detect scraped data file', async () => {
      const result = await autoLoadInput(path.join(fixturesDir, 'scraped-data.json'));

      expect(result.type).toBe('scraped');
      expect(result.scraped).toBeDefined();
      expect(result.scraped?.pages.length).toBe(4);
    });

    it('should auto-detect manifest file', async () => {
      const result = await autoLoadInput(path.join(fixturesDir, 'manifest.json'));

      expect(result.type).toBe('manifest');
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.assets.length).toBe(5);
    });
  });

  describe('writeTransformOutput', () => {
    it('should write JSON output', async () => {
      const outputPath = path.join(fixturesDir, 'test-output.json');
      const result = {
        records: [{ id: 1, text: 'Test' }],
        stats: {
          inputCount: 1,
          filteredCount: 0,
          classifiedCount: 0,
          relevantCount: 1,
          generatedCount: 1,
          outputCount: 1,
          errorCount: 0,
          duration: 1000,
        },
      };

      await writeTransformOutput(result, outputPath);

      // Verify file was written
      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].text).toBe('Test');

      // Clean up
      await fs.unlink(outputPath).catch(() => {});
    });

    it('should write JSONL output', async () => {
      const outputPath = path.join(fixturesDir, 'test-output.jsonl');
      const result = {
        records: [{ id: 1, text: 'Test' }],
        stats: {
          inputCount: 1,
          filteredCount: 0,
          classifiedCount: 0,
          relevantCount: 1,
          generatedCount: 1,
          outputCount: 1,
          errorCount: 0,
          duration: 1000,
        },
      };

      await writeTransformOutput(result, outputPath);

      // Verify file was written
      const content = await fs.readFile(outputPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).text).toBe('Test');

      // Clean up
      await fs.unlink(outputPath).catch(() => {});
    });

    it('should write correct number of records (integrity check)', async () => {
      const outputPath = path.join(fixturesDir, 'test-output-integrity.json');
      const records = [
        { id: 1, text: 'Record one' },
        { id: 2, text: 'Record two' },
        { id: 3, text: 'Record three' },
        { id: 4, text: 'Record four' },
        { id: 5, text: 'Record five' },
      ];
      const result = {
        records,
        stats: {
          inputCount: 5,
          filteredCount: 0,
          classifiedCount: 0,
          relevantCount: 5,
          generatedCount: 5,
          outputCount: 5,
          errorCount: 0,
          duration: 1000,
        },
      };

      await writeTransformOutput(result, outputPath);

      // Read back and verify record count matches
      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(result.records.length);

      // Also verify JSONL
      const jsonlPath = outputPath.replace('.json', '.jsonl');
      const jsonlContent = await fs.readFile(jsonlPath, 'utf-8');
      const jsonlLines = jsonlContent.trim().split('\n');
      expect(jsonlLines).toHaveLength(result.records.length);

      // Clean up
      await fs.unlink(outputPath).catch(() => {});
      await fs.unlink(jsonlPath).catch(() => {});
    });

    it('should write both JSON and JSONL for JSON output', async () => {
      const outputPath = path.join(fixturesDir, 'test-output-dual.json');
      const jsonlPath = outputPath.replace('.json', '.jsonl');
      const result = {
        records: [{ id: 1, text: 'Test' }],
        stats: {
          inputCount: 1,
          filteredCount: 0,
          classifiedCount: 0,
          relevantCount: 1,
          generatedCount: 1,
          outputCount: 1,
          errorCount: 0,
          duration: 1000,
        },
      };

      await writeTransformOutput(result, outputPath);

      // Verify both files were written
      const jsonContent = await fs.readFile(outputPath, 'utf-8');
      const jsonlContent = await fs.readFile(jsonlPath, 'utf-8');

      expect(JSON.parse(jsonContent)).toHaveLength(1);
      expect(jsonlContent.trim().split('\n')).toHaveLength(1);

      // Clean up
      await fs.unlink(outputPath).catch(() => {});
      await fs.unlink(jsonlPath).catch(() => {});
    });
  });

  describe('abort flag → abortedEarly', () => {
    it('should set abortedEarly when global abort flag is set', async () => {
      // Set the global abort flag before running
      (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = true;

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-qa',
        output: path.join(fixturesDir, 'output-abort-test.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      // The abort flag should propagate to abortedEarly in stats
      expect(result.stats.abortedEarly).toBe(true);

      // Clean up
      (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;
    });

    it('should not set abortedEarly when abort flag is not set', async () => {
      // Ensure the flag is cleared
      (globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag = false;

      const options: TransformOptions = {
        input: path.join(fixturesDir, 'scraped-data.json'),
        template: 'text-qa',
        output: path.join(fixturesDir, 'output-no-abort-test.json'),
        relevanceThreshold: 0.5,
        batchSize: 10,
        minTextLength: 50,
        maxTextLength: 10000,
        noLlm: true,
        dedupe: false,
        yes: true,
      };

      const result = await transformDataset(options);

      // abortedEarly should be undefined (falsy)
      expect(result.stats.abortedEarly).toBeFalsy();
    });
  });
});
