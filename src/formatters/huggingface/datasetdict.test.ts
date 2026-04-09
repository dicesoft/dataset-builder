/**
 * Tests for DatasetDict formatter
 */

import path from 'path';
import os from 'os';
import { vi } from 'vitest';
import { DatasetDictFormatter } from './datasetdict';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock formatters/utils - must preserve real exports like inferType used by huggingface/utils.ts
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeData: vi.fn().mockResolvedValue(undefined),
    splitDataset: vi
      .fn()
      .mockImplementation((data: unknown[], ratios: [number, number, number]) => {
        const trainSize = Math.floor(data.length * ratios[0]);
        const valSize = Math.floor(data.length * ratios[1]);
        return {
          train: data.slice(0, trainSize),
          validation: data.slice(trainSize, trainSize + valSize),
          test: data.slice(trainSize + valSize),
        };
      }),
    computeStatistics: vi.fn().mockReturnValue({
      avgRecordSize: 50,
      totalTokens: 500,
      avgTokensPerRecord: 50,
      fieldStats: {},
    }),
  };
});

// Mock HF card
vi.mock('./card', () => ({
  writeDatasetCard: vi.fn().mockResolvedValue('/output/README.md'),
}));

import { writeData } from '../utils';
import { writeDatasetCard } from './card';

describe('DatasetDictFormatter', () => {
  let formatter: DatasetDictFormatter;

  const sampleData = [
    { id: 1, text: 'Record one', category: 'A' },
    { id: 2, text: 'Record two', category: 'B' },
    { id: 3, text: 'Record three', category: 'A' },
    { id: 4, text: 'Record four', category: 'B' },
    { id: 5, text: 'Record five', category: 'A' },
    { id: 6, text: 'Record six', category: 'B' },
    { id: 7, text: 'Record seven', category: 'A' },
    { id: 8, text: 'Record eight', category: 'B' },
    { id: 9, text: 'Record nine', category: 'A' },
    { id: 10, text: 'Record ten', category: 'B' },
  ];

  beforeEach(() => {
    formatter = new DatasetDictFormatter();
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('should accept any non-empty data array', () => {
      const result = formatter.validate(sampleData);
      expect(result.valid).toBe(true);
      expect(result.stats?.total).toBe(10);
    });

    it('should reject empty data', () => {
      const result = formatter.validate([]);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('empty');
    });

    it('should reject invalid outputFormat', () => {
      const result = formatter.validate(sampleData, { outputFormat: 'xml' as any });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Unsupported output format');
    });
  });

  describe('format', () => {
    it('should create JSON split files (train only when no splitRatios)', async () => {
      const outputDir = path.join(os.tmpdir(), `dd-test-${Date.now()}`);
      const result = await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'datasetdict',
      });

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('datasetdict');
      expect(result.metadata.counts.train).toBe(10);
      expect(result.metadata.counts.total).toBe(10);
      // Should write data files + dataset_info.json
      expect(writeData).toHaveBeenCalled();
    });

    it('should split data with provided ratios', async () => {
      const outputDir = path.join(os.tmpdir(), `dd-split-${Date.now()}`);
      const result = await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'datasetdict',
        splitRatios: [0.8, 0.1, 0.1],
      });

      // splitDataset mock is called with [0.8, 0.1, 0.1]
      const totalSplit =
        result.metadata.counts.train +
        result.metadata.counts.validation +
        result.metadata.counts.test;
      expect(totalSplit).toBe(10);
    });

    it('should generate dataset_info.json', async () => {
      const outputDir = path.join(os.tmpdir(), `dd-info-${Date.now()}`);
      await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'datasetdict',
      });

      // Check that writeData was called with dataset_info.json path
      const calls = vi.mocked(writeData).mock.calls;
      const infoCall = calls.find((c) => String(c[0]).includes('dataset_info.json'));
      expect(infoCall).toBeTruthy();
    });

    it('should generate README.md when generateCard is true', async () => {
      const outputDir = path.join(os.tmpdir(), `dd-card-${Date.now()}`);
      await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'datasetdict',
        generateCard: true,
      });

      expect(writeDatasetCard).toHaveBeenCalled();
    });

    it('should not generate README.md when generateCard is false', async () => {
      const outputDir = path.join(os.tmpdir(), `dd-nocard-${Date.now()}`);
      await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'datasetdict',
      });

      expect(writeDatasetCard).not.toHaveBeenCalled();
    });

    it('should use custom split ratios', async () => {
      const outputDir = path.join(os.tmpdir(), `dd-custom-${Date.now()}`);
      const result = await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'datasetdict',
        splitRatios: [0.6, 0.2, 0.2],
      });

      expect(result.metadata.counts.train).toBe(6);
    });
  });

  describe('handlesOwnSplitting', () => {
    it('should be true', () => {
      expect(formatter.handlesOwnSplitting).toBe(true);
    });
  });
});
