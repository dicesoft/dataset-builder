import { describe, it, expect, vi } from 'vitest';
import { runCleanup } from './index';
import type { CleanupProgressCallback } from './index';

describe('runCleanup', () => {
  const sampleData = [
    {
      instruction: 'What is AI?',
      output: 'AI is the simulation of human intelligence by machines.',
      url: 'https://example.com/ai',
    },
    {
      instruction: 'What is AI?',
      output: 'AI is the simulation of human intelligence by machines.',
      url: 'https://example.com/ai',
    },
    {
      instruction: 'Explain ML',
      output: 'Machine Learning is a subset of AI.',
      url: 'https://example.com/ml',
    },
    { instruction: '', output: 'No instruction here', url: 'https://example.com/empty' },
    {
      instruction: 'Valid entry',
      output: 'This is a valid entry with enough content.',
      url: 'https://example.com/valid',
    },
  ];

  it('removes duplicates when dedupe is enabled', async () => {
    const result = await runCleanup(sampleData, { dedupe: true });
    expect(result.data.length).toBeLessThan(sampleData.length);
    expect(result.stats.stages.dedupe.removed).toBeGreaterThan(0);
  });

  it('removes records with missing required fields when validate is enabled', async () => {
    const result = await runCleanup(sampleData, {
      validate: true,
      requiredFields: ['instruction', 'output'],
    });
    // Record with empty instruction should be removed
    expect(result.data.length).toBeLessThan(sampleData.length);
    expect(result.stats.stages.validate.removed).toBeGreaterThan(0);
  });

  it('filters by quality threshold when quality is enabled', async () => {
    const dataWithContent = [
      { instruction: 'Q1', output: 'x'.repeat(200), content: 'x'.repeat(200) },
      { instruction: 'Q2', output: 'y', content: 'y' },
      { instruction: 'Q3', output: 'z'.repeat(500), content: 'z'.repeat(500) },
    ];
    const result = await runCleanup(dataWithContent, {
      quality: true,
      qualityThreshold: 8,
      minLength: 100,
    });
    // Short content records should be filtered out
    expect(result.stats.scored).toBeGreaterThan(0);
  });

  it('removes records with empty values when removeEmpty is enabled', async () => {
    const result = await runCleanup(sampleData, {
      removeEmpty: true,
      requiredFields: ['instruction', 'output'],
    });
    const remaining = result.data as Array<Record<string, unknown>>;
    for (const record of remaining) {
      expect(record.instruction).not.toBe('');
      expect(record.instruction).not.toBeNull();
      expect(record.output).not.toBe('');
      expect(record.output).not.toBeNull();
    }
  });

  it('combines multiple cleanup stages', async () => {
    const result = await runCleanup(sampleData, {
      dedupe: true,
      validate: true,
      requiredFields: ['instruction', 'output'],
      removeEmpty: true,
    });
    expect(result.data.length).toBeLessThan(sampleData.length);
    expect(result.stats.removed).toBeGreaterThan(0);
    expect(result.stats.input).toBe(sampleData.length);
    expect(result.stats.output).toBe(result.data.length);
  });

  it('tracks stats correctly (input/output/removed counts)', async () => {
    const result = await runCleanup(sampleData, {
      dedupe: true,
      validate: true,
      requiredFields: ['instruction', 'output'],
    });
    expect(result.stats.input).toBe(sampleData.length);
    expect(result.stats.output).toBe(result.data.length);
    expect(result.stats.removed).toBe(result.stats.input - result.stats.output);
  });

  it('invokes progress callback for each active stage', async () => {
    const progressCalls: Array<{ stage: string }> = [];
    const onProgress: CleanupProgressCallback = (progress) => {
      progressCalls.push({ stage: progress.stage });
    };

    await runCleanup(
      sampleData,
      {
        dedupe: true,
        validate: true,
        requiredFields: ['instruction', 'output'],
        removeEmpty: true,
      },
      onProgress
    );

    const stages = progressCalls.map((c) => c.stage);
    expect(stages).toContain('dedupe');
    expect(stages).toContain('validate');
    expect(stages).toContain('filter-empty');
  });

  it('handles empty input array', async () => {
    const result = await runCleanup([], {
      dedupe: true,
      validate: true,
      requiredFields: ['instruction'],
    });
    expect(result.data).toEqual([]);
    expect(result.stats.input).toBe(0);
    expect(result.stats.output).toBe(0);
    expect(result.stats.removed).toBe(0);
  });
});
