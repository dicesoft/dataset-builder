import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { AlpacaFormatter, formatToAlpaca } from './alpaca';

const written: Record<string, string> = {};

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockImplementation((filePath: string, content: string) => {
      written[filePath] = content;
      return Promise.resolve();
    }),
    readFile: vi.fn().mockResolvedValue('[]'),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('AlpacaFormatter', () => {
  let formatter: AlpacaFormatter;

  beforeEach(() => {
    formatter = new AlpacaFormatter();
    for (const key of Object.keys(written)) {
      delete written[key];
    }
  });

  describe('validate', () => {
    it('should pass valid records with instruction and output', () => {
      const input = [
        { instruction: 'What is 2+2?', output: '4' },
        { instruction: 'Say hello', output: 'Hello!' },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stats?.valid).toBe(2);
      expect(result.stats?.invalid).toBe(0);
    });

    it('should fail when instruction is missing', () => {
      const input = [{ output: 'some output' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'instruction')).toBe(true);
    });

    it('should fail when output is missing', () => {
      const input = [{ instruction: 'do something' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'output')).toBe(true);
    });

    it('should fail when instruction is not a string', () => {
      const input = [{ instruction: 123, output: 'ok' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('must be a string');
    });

    it('should accept records with optional input field', () => {
      const input = [{ instruction: 'Translate', input: 'Hello', output: 'Hola' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when optional input is not a string', () => {
      const input = [{ instruction: 'Do it', input: 42, output: 'Done' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'input')).toBe(true);
    });
  });

  describe('format', () => {
    it('should format records and write output files', async () => {
      const outputDir = path.join(os.tmpdir(), 'alpaca-test');
      const input = [
        { instruction: 'What is 2+2?', output: '4' },
        { instruction: 'Say hi', output: 'Hi!' },
      ];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'alpaca',
      });

      expect(result.outputDir).toBe(outputDir);
      expect(result.files.all).toHaveLength(2);
      expect(result.metadata.formatter).toBe('alpaca');
      expect(result.metadata.counts.total).toBe(2);

      const jsonPath = path.join(outputDir, 'data.json');
      expect(written[jsonPath]).toBeDefined();
      const parsed = JSON.parse(written[jsonPath]);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].instruction).toBe('What is 2+2?');

      const jsonlPath = path.join(outputDir, 'data.jsonl');
      expect(written[jsonlPath]).toBeDefined();
      const lines = written[jsonlPath].split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should include empty input field by default', async () => {
      const outputDir = path.join(os.tmpdir(), 'alpaca-empty-input');
      const input = [{ instruction: 'Test', output: 'Result' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'alpaca',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0]).toHaveProperty('input');
      expect(parsed[0].input).toBe('');
    });

    it('should exclude empty input when includeEmptyInput is false', async () => {
      const outputDir = path.join(os.tmpdir(), 'alpaca-no-empty');
      const input = [{ instruction: 'Test', output: 'Result' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'alpaca',
        includeEmptyInput: false,
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0]).not.toHaveProperty('input');
    });

    it('should use defaultInput when no input is provided', async () => {
      const outputDir = path.join(os.tmpdir(), 'alpaca-default');
      const input = [{ instruction: 'Test', output: 'Result' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'alpaca',
        defaultInput: 'N/A',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].input).toBe('N/A');
    });

    it('should filter out records with empty required fields', async () => {
      const outputDir = path.join(os.tmpdir(), 'alpaca-filter');
      const input = [
        { instruction: 'Valid', output: 'Yes' },
        { instruction: '', output: 'No instruction' },
        { instruction: 'No output', output: '   ' },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'alpaca',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].instruction).toBe('Valid');
    });
  });

  describe('formatToAlpaca', () => {
    it('should format data using convenience function', async () => {
      const outputDir = path.join(os.tmpdir(), 'alpaca-convenience');
      const data = [{ instruction: 'Hello', output: 'World' }];
      const result = await formatToAlpaca(data, outputDir);

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('alpaca');
      expect(result.metadata.counts.total).toBe(1);
    });
  });
});
