import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { RawFormatter, formatToRaw } from './raw';

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

describe('RawFormatter', () => {
  let formatter: RawFormatter;

  beforeEach(() => {
    formatter = new RawFormatter();
    for (const key of Object.keys(written)) {
      delete written[key];
    }
  });

  describe('validate', () => {
    it('should pass valid prompt/completion records', () => {
      const input = [{ prompt: 'Hello', completion: 'World' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stats?.valid).toBe(1);
    });

    it('should accept instruction as fallback for prompt', () => {
      const input = [{ instruction: 'Do something', completion: 'Done' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });

    it('should accept output as fallback for completion', () => {
      const input = [{ prompt: 'Question', output: 'Answer' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });

    it('should accept response as fallback for completion', () => {
      const input = [{ prompt: 'Ask', response: 'Reply' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });

    it('should fail when no prompt-like field exists', () => {
      const input = [{ completion: 'No prompt here' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('prompt');
    });

    it('should fail when no completion-like field exists', () => {
      const input = [{ prompt: 'No completion here' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('completion');
    });
  });

  describe('format', () => {
    it('should create raw prompt/completion pairs', async () => {
      const outputDir = path.join(os.tmpdir(), 'raw-basic');
      const input = [{ prompt: 'Hello', completion: 'World' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'raw',
      });

      expect(result.metadata.formatter).toBe('raw');
      expect(result.metadata.counts.total).toBe(1);

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].prompt).toBe('Hello');
      expect(parsed[0].completion).toBe('World');
    });

    it('should use instruction->prompt and output->completion fallback', async () => {
      const outputDir = path.join(os.tmpdir(), 'raw-fallback');
      const input = [{ instruction: 'Explain gravity', output: 'Gravity is a force...' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'raw',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].prompt).toBe('Explain gravity');
      expect(parsed[0].completion).toBe('Gravity is a force...');
    });

    it('should filter out records with empty prompt or completion', async () => {
      const outputDir = path.join(os.tmpdir(), 'raw-filter');
      const input = [
        { prompt: 'Valid', completion: 'Yes' },
        { prompt: '', completion: 'No prompt' },
        { prompt: 'No completion', completion: '' },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'raw',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].prompt).toBe('Valid');
    });

    it('should write JSON, JSONL, and CSV files', async () => {
      const outputDir = path.join(os.tmpdir(), 'raw-files');
      const input = [{ prompt: 'Test', completion: 'OK' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'raw',
      });

      expect(result.files.all).toHaveLength(3);
      expect(written[path.join(outputDir, 'data.json')]).toBeDefined();
      expect(written[path.join(outputDir, 'data.jsonl')]).toBeDefined();
      expect(written[path.join(outputDir, 'data.csv')]).toBeDefined();

      const csv = written[path.join(outputDir, 'data.csv')];
      expect(csv).toContain('prompt,completion');
      expect(csv).toContain('Test');
    });
  });

  describe('formatToRaw', () => {
    it('should format data using convenience function', async () => {
      const outputDir = path.join(os.tmpdir(), 'raw-convenience');
      const data = [{ prompt: 'Ping', completion: 'Pong' }];
      const result = await formatToRaw(data, outputDir);

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('raw');
      expect(result.metadata.counts.total).toBe(1);
    });
  });
});
