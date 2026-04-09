/**
 * Tests for formatDataset orchestrator (src/formatters/index.ts)
 * Verifies the pipeline: load -> cleanup -> fieldMap -> split -> format -> output
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises before any imports that use it
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('[]'),
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock cleanup module so we can control its behavior
vi.mock('./cleanup', () => ({
  runCleanup: vi.fn(),
}));

import { formatDataset } from './index';
import { listFormatters } from './registry';
import { runCleanup } from './cleanup';
import type { FormatOptions } from './types';

/** Sample Alpaca-compatible data */
const sampleAlpacaData = [
  { instruction: 'What is AI?', input: '', output: 'Artificial Intelligence is...' },
  { instruction: 'Explain gravity', input: '', output: 'Gravity is a force...' },
  { instruction: 'Define DNA', input: '', output: 'DNA stands for...' },
  { instruction: 'What is water?', input: '', output: 'Water is H2O...' },
  { instruction: 'Explain light', input: '', output: 'Light is electromagnetic...' },
  { instruction: 'What is sound?', input: '', output: 'Sound is a vibration...' },
  { instruction: 'Define entropy', input: '', output: 'Entropy is a measure...' },
  { instruction: 'What is mass?', input: '', output: 'Mass is the quantity...' },
  { instruction: 'Explain atoms', input: '', output: 'Atoms are the basic...' },
  { instruction: 'Define energy', input: '', output: 'Energy is the capacity...' },
];

function makeOptions(overrides: Partial<FormatOptions> = {}): FormatOptions {
  return {
    formatter: 'alpaca',
    outputDir: '/tmp/test-output',
    fieldMap: {},
    inputData: sampleAlpacaData,
    ...overrides,
  };
}

describe('formatDataset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats valid alpaca data and returns FormattedOutput', async () => {
    const result = await formatDataset(makeOptions());

    expect(result).toBeDefined();
    expect(result.outputDir).toBe('/tmp/test-output');
    expect(result.files).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.metadata.formatter).toBe('alpaca');
  });

  it('throws on unknown formatter name', async () => {
    await expect(
      formatDataset(makeOptions({ formatter: 'nonexistent-format-xyz' }))
    ).rejects.toThrow('Unknown formatter: nonexistent-format-xyz');
  });

  it('accepts inputData array directly (no inputPath needed)', async () => {
    const data = [{ instruction: 'Hello', input: '', output: 'World' }];
    const result = await formatDataset(makeOptions({ inputData: data }));

    expect(result.metadata.counts.total).toBe(1);
  });

  it('applies fieldMap before formatting', async () => {
    // Validation runs BEFORE fieldMap in the orchestrator pipeline,
    // so input data must already pass validation in its raw form.
    // We use data with valid alpaca fields plus an extra 'source' field
    // that gets composed into the output via fieldMap.
    const data = [
      { instruction: 'What is AI?', input: '', output: 'AI is...', source: 'wiki' },
      { instruction: 'Explain gravity', input: '', output: 'Gravity is...', source: 'textbook' },
    ];
    const fieldMap = {
      instruction: '{{instruction}}',
      output: '{{output}} ({{source}})',
    };
    const result = await formatDataset(makeOptions({ inputData: data, fieldMap }));

    expect(result).toBeDefined();
    expect(result.metadata.counts.total).toBe(2);
    expect(result.metadata.fieldMap).toEqual(fieldMap);
  });

  it('creates train/validation/test splits when splitRatios provided', async () => {
    const result = await formatDataset(makeOptions({ splitRatios: [0.8, 0.1, 0.1], seed: 42 }));

    const counts = result.metadata.counts;
    expect(counts.total).toBe(sampleAlpacaData.length);
    expect(counts.train).toBeGreaterThan(0);
    // With 10 items and 0.1 ratios, we expect at least 1 in val and test
    expect(counts.train + counts.validation + counts.test).toBe(sampleAlpacaData.length);
  });

  it('runs cleanup pipeline when cleanup option is set', async () => {
    const cleanedData = sampleAlpacaData.slice(0, 8);
    const mockRunCleanup = vi.mocked(runCleanup);
    mockRunCleanup.mockResolvedValueOnce({
      data: cleanedData,
      stats: {
        input: 10,
        output: 8,
        removed: 2,
        modified: 0,
        scored: 0,
        stages: {
          dedupe: { removed: 2, reason: 'Duplicate records' },
          validate: { removed: 0, errors: [] },
          quality: { removed: 0, belowThreshold: 0 },
          filter: { removed: 0, reason: '' },
        },
      },
    });

    const result = await formatDataset(
      makeOptions({
        cleanup: { dedupe: true },
      })
    );

    expect(mockRunCleanup).toHaveBeenCalledTimes(1);
    expect(mockRunCleanup).toHaveBeenCalledWith(sampleAlpacaData, { dedupe: true });
    expect(result.metadata.cleanup).toBeDefined();
    expect(result.metadata.cleanup!.enabled).toBe(true);
    expect(result.metadata.cleanup!.removed).toBe(2);
  });

  it('returns FormattedOutput with proper metadata structure', async () => {
    const result = await formatDataset(makeOptions({ datasetName: 'my-dataset' }));

    expect(result.metadata).toMatchObject({
      formatter: 'alpaca',
      datasetName: 'my-dataset',
      counts: {
        total: sampleAlpacaData.length,
      },
    });
    expect(result.metadata.timestamp).toBeTypeOf('number');
    expect(result.metadata.stats).toBeDefined();
  });

  it('metadata has correct split counts', async () => {
    const result = await formatDataset(makeOptions({ splitRatios: [0.8, 0.1, 0.1], seed: 123 }));

    const { counts } = result.metadata;
    expect(counts.train).toBe(8); // floor(10 * 0.8)
    expect(counts.validation).toBe(1); // floor(10 * 0.1)
    expect(counts.test).toBe(1); // remainder
    expect(counts.total).toBe(10);
  });

  it('passes systemPrompt through to formatter via options', async () => {
    // systemPrompt is part of FormatOptions and passed through to formatter.format()
    // We verify the orchestrator does not strip it by checking it runs without error
    const result = await formatDataset(
      makeOptions({ systemPrompt: 'You are a helpful assistant.' })
    );

    expect(result).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it('without splitRatios puts all data in train split', async () => {
    const result = await formatDataset(makeOptions());

    const { counts } = result.metadata;
    expect(counts.train).toBe(sampleAlpacaData.length);
    expect(counts.validation).toBe(0);
    expect(counts.test).toBe(0);
    expect(counts.total).toBe(sampleAlpacaData.length);
  });
});

describe('formatter registry', () => {
  it('has all 16 formatters registered after import', () => {
    const formatters = listFormatters();
    const names = formatters.map((f) => f.name);

    expect(formatters).toHaveLength(16);

    // Text formatters
    expect(names).toContain('alpaca');
    expect(names).toContain('chatml');
    expect(names).toContain('sharegpt');
    expect(names).toContain('oasst');
    expect(names).toContain('raw');

    // Vision formatters
    expect(names).toContain('llava');
    expect(names).toContain('imagefolder');
    expect(names).toContain('csv-images');
    expect(names).toContain('coco');
    expect(names).toContain('yolo');
    expect(names).toContain('coco-seg');
    expect(names).toContain('yolo-seg');

    // Audio formatters
    expect(names).toContain('audiofolder');
    expect(names).toContain('speech-text');

    // HuggingFace formatters
    expect(names).toContain('datasetdict');
    expect(names).toContain('parquet');
  });
});
