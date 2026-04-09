/**
 * Unit tests for vision filter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VisionFilterOptions } from '../visionFilter';

// Mock dependencies
const mockAnalyzeImage = vi.fn();
vi.mock('../../generators/vision-utils', () => ({
  analyzeImage: (...args: unknown[]) => mockAnalyzeImage(...args),
}));

vi.mock('../../config', () => ({
  getConfig: vi.fn(() => ({
    get: vi.fn((key: string) => {
      if (key === 'ollamaVisionModel') return 'llava';
      if (key === 'ollamaModel') return 'llama2';
      return undefined;
    }),
  })),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from('fake-image')),
    readdirSync: vi.fn(() => []),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from('fake-image')),
  readdirSync: vi.fn(() => []),
}));

vi.mock('../../downloader/fileHandler', () => ({
  detectFileType: vi.fn(() => 'image'),
}));

let filterImage: typeof import('../visionFilter').filterImage;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../visionFilter');
  filterImage = mod.filterImage;
});

describe('filterImage', () => {
  const baseOptions: VisionFilterOptions = {
    sensitivity: 0.5,
    target: 'cats and dogs',
    checkNSFW: true,
    checkRelevance: true,
  };

  it('should pass images to analyzeImage (not generate without images)', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.9,
        confidence: 0.8,
        passed: true,
        reasons: [],
      })
    );

    const result = await filterImage('/fake/image.jpg', baseOptions);

    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      '/fake/image.jpg',
      expect.stringContaining('Analyze this image'),
      undefined
    );
    expect(result.passed).toBe(true);
  });

  it('should fail images with relevance below sensitivity threshold', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.2,
        confidence: 0.8,
        passed: true,
        reasons: [],
      })
    );

    const result = await filterImage('/fake/image.jpg', {
      ...baseOptions,
      sensitivity: 0.5,
    });

    expect(result.passed).toBe(false);
  });

  it('should pass images with relevance above sensitivity threshold', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.8,
        confidence: 0.9,
        passed: true,
        reasons: [],
      })
    );

    const result = await filterImage('/fake/image.jpg', {
      ...baseOptions,
      sensitivity: 0.5,
    });

    expect(result.passed).toBe(true);
  });

  it('should fail NSFW images regardless of relevance', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: true,
        relevance: 0.9,
        confidence: 0.9,
        passed: false,
        reasons: ['NSFW content detected'],
      })
    );

    const result = await filterImage('/fake/image.jpg', baseOptions);

    expect(result.passed).toBe(false);
    expect(result.isNSFW).toBe(true);
  });

  it('should not check relevance when no target is specified', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.1,
        confidence: 0.8,
        passed: true,
        reasons: [],
      })
    );

    const result = await filterImage('/fake/image.jpg', {
      sensitivity: 0.5,
      checkNSFW: true,
      // no target
    });

    expect(result.passed).toBe(true);
  });

  it('should pass by default on parse errors', async () => {
    mockAnalyzeImage.mockResolvedValue('not valid json at all');

    const result = await filterImage('/fake/image.jpg', baseOptions);

    expect(result.passed).toBe(true);
    expect(result.reasons).toContain('Could not parse response');
  });

  it('should throw when vision model is not found', async () => {
    mockAnalyzeImage.mockRejectedValue(new Error('Model not found'));

    await expect(filterImage('/fake/image.jpg', baseOptions)).rejects.toThrow(
      'Vision model not available'
    );
  });

  it('should pass by default on transient vision errors', async () => {
    mockAnalyzeImage.mockRejectedValue(new Error('connection timeout'));

    const result = await filterImage('/fake/image.jpg', baseOptions);

    expect(result.passed).toBe(true);
    expect(result.reasons[0]).toContain('Vision analysis unavailable');
  });

  it('should pass model option through to analyzeImage', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.9,
        confidence: 0.8,
        passed: true,
        reasons: [],
      })
    );

    await filterImage('/fake/image.jpg', {
      ...baseOptions,
      model: 'llava:13b',
    });

    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      '/fake/image.jpg',
      expect.any(String),
      'llava:13b'
    );
  });

  it('should use custom prompt when provided', async () => {
    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.9,
        confidence: 0.8,
        passed: true,
        reasons: [],
      })
    );

    await filterImage('/fake/image.jpg', {
      ...baseOptions,
      prompt: 'Is this a photo of food?',
    });

    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      '/fake/image.jpg',
      expect.stringContaining('Is this a photo of food?'),
      undefined
    );
  });

  it('should log verbose output when verbose is true', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.85,
        confidence: 0.92,
        passed: true,
        reasons: [],
      })
    );

    await filterImage('/fake/image.jpg', {
      ...baseOptions,
      verbose: true,
    });

    const logs = consoleSpy.mock.calls.map((c) => c[0]);
    expect(logs.some((l: string) => l.includes('[vision] File:'))).toBe(true);
    expect(logs.some((l: string) => l.includes('[vision] Model:'))).toBe(true);
    expect(logs.some((l: string) => l.includes('[vision] Prompt:'))).toBe(true);
    expect(logs.some((l: string) => l.includes('[vision] Raw response:'))).toBe(true);
    expect(logs.some((l: string) => l.includes('[vision] Result: PASSED'))).toBe(true);

    consoleSpy.mockRestore();
  });

  it('should not log verbose output when verbose is false', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.85,
        confidence: 0.92,
        passed: true,
        reasons: [],
      })
    );

    await filterImage('/fake/image.jpg', {
      ...baseOptions,
      verbose: false,
    });

    const logs = consoleSpy.mock.calls.map((c) => c[0]);
    expect(logs.some((l: string) => typeof l === 'string' && l.includes('[vision]'))).toBe(false);

    consoleSpy.mockRestore();
  });

  it('should use tracker.log instead of console.log when tracker is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockTracker = { log: vi.fn() };

    mockAnalyzeImage.mockResolvedValue(
      JSON.stringify({
        isNSFW: false,
        relevance: 0.85,
        confidence: 0.92,
        passed: true,
        reasons: [],
      })
    );

    await filterImage('/fake/image.jpg', {
      ...baseOptions,
      verbose: true,
      tracker: mockTracker as any,
    });

    // tracker.log should have been called for verbose lines
    expect(mockTracker.log).toHaveBeenCalled();
    const trackerLogs = mockTracker.log.mock.calls.map((c: any) => c[0]);
    expect(trackerLogs.some((l: string) => l.includes('[vision] File:'))).toBe(true);

    // console.log should NOT have been called for vision lines
    const consoleLogs = consoleSpy.mock.calls.map((c: any) => c[0]);
    expect(consoleLogs.some((l: string) => typeof l === 'string' && l.includes('[vision]'))).toBe(
      false
    );

    consoleSpy.mockRestore();
  });

  it('should log error in verbose mode when vision fails', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockAnalyzeImage.mockRejectedValue(new Error('Connection refused'));

    await filterImage('/fake/image.jpg', {
      ...baseOptions,
      verbose: true,
    });

    const logs = consoleSpy.mock.calls.map((c) => c[0]);
    expect(logs.some((l: string) => l.includes('[vision] Error: Connection refused'))).toBe(true);

    consoleSpy.mockRestore();
  });
});
