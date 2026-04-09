import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { formatDataset } from '../../formatters';

describe('formatDataset field mapping before validation', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should succeed when fieldMap maps unmapped fields to required fields', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));

    // Data has "question" and "answer" instead of "instruction" and "output"
    const inputData = [
      { question: 'What is 2+2?', answer: '4' },
      { question: 'What color is the sky?', answer: 'Blue' },
    ];

    const result = await formatDataset({
      formatter: 'alpaca',
      inputData,
      outputDir: tmpDir,
      fieldMap: {
        instruction: '{{question}}',
        output: '{{answer}}',
      },
    });

    expect(result).toBeDefined();
    expect(result.outputDir).toBe(tmpDir);
  });

  it('should fail validation when required fields are genuinely missing', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-test-'));

    // Data missing required fields with no field mapping to fix it
    const inputData = [{ foo: 'bar', baz: 'qux' }];

    await expect(
      formatDataset({
        formatter: 'alpaca',
        inputData,
        outputDir: tmpDir,
        fieldMap: {},
      })
    ).rejects.toThrow('Validation failed');
  });
});
