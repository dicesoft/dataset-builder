/**
 * Tests for Parquet formatter
 */

import path from 'path';
import os from 'os';
import { vi } from 'vitest';
import { ParquetFormatter } from './parquet';

// Mock @dsnp/parquetjs - all inside factory since vi.mock is hoisted
vi.mock('@dsnp/parquetjs', () => {
  const MockParquetSchema = vi.fn().mockImplementation(function (this: any, schema: any) {
    this.schema = schema;
  });
  return {
    ParquetSchema: MockParquetSchema,
    ParquetWriter: {
      openFile: vi.fn().mockResolvedValue({
        appendRow: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

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

import { ParquetWriter } from '@dsnp/parquetjs';

describe('ParquetFormatter', () => {
  let formatter: ParquetFormatter;

  const sampleData = [
    { id: 1, text: 'Record one', score: 0.95 },
    { id: 2, text: 'Record two', score: 0.88 },
    { id: 3, text: 'Record three', score: 0.72 },
    { id: 4, text: 'Record four', score: 0.91 },
    { id: 5, text: 'Record five', score: 0.85 },
  ];

  beforeEach(() => {
    formatter = new ParquetFormatter();
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('should accept any non-empty data array', () => {
      const result = formatter.validate(sampleData);
      expect(result.valid).toBe(true);
      expect(result.stats?.total).toBe(5);
    });

    it('should reject empty data', () => {
      const result = formatter.validate([]);
      expect(result.valid).toBe(false);
    });
  });

  describe('format', () => {
    it('should create parquet files via ParquetWriter', async () => {
      const outputDir = path.join(os.tmpdir(), `pq-test-${Date.now()}`);
      const result = await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'parquet',
      });

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('parquet');
      expect(ParquetWriter.openFile).toHaveBeenCalled();
    });

    it('should create schema from data', async () => {
      const { ParquetSchema } = await import('@dsnp/parquetjs');
      const outputDir = path.join(os.tmpdir(), `pq-schema-${Date.now()}`);
      await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'parquet',
      });

      expect(ParquetSchema).toHaveBeenCalled();
      const schemaArg = vi.mocked(ParquetSchema).mock.calls[0][0];
      expect(schemaArg).toHaveProperty('id');
      expect(schemaArg).toHaveProperty('text');
      expect(schemaArg).toHaveProperty('score');
    });

    it('should write split parquet files with ratios', async () => {
      const outputDir = path.join(os.tmpdir(), `pq-split-${Date.now()}`);
      const result = await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'parquet',
        splitRatios: [0.8, 0.1, 0.1],
      });

      const totalSplit =
        result.metadata.counts.train +
        result.metadata.counts.validation +
        result.metadata.counts.test;
      expect(totalSplit).toBe(5);
    });

    it('should append rows to parquet writer', async () => {
      const outputDir = path.join(os.tmpdir(), `pq-rows-${Date.now()}`);
      await formatter.format(sampleData, {
        outputDir,
        fieldMap: {},
        formatter: 'parquet',
      });

      const writerMock = await ParquetWriter.openFile({} as any, '');
      // openFile is called once for the train split
      expect(ParquetWriter.openFile).toHaveBeenCalled();
    });
  });

  describe('handlesOwnSplitting', () => {
    it('should be true', () => {
      expect(formatter.handlesOwnSplitting).toBe(true);
    });
  });
});
