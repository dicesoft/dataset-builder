import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { ShareGPTFormatter, formatToShareGPT } from './sharegpt';

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

describe('ShareGPTFormatter', () => {
  let formatter: ShareGPTFormatter;

  beforeEach(() => {
    formatter = new ShareGPTFormatter();
    for (const key of Object.keys(written)) {
      delete written[key];
    }
  });

  describe('validate', () => {
    it('should pass valid records with conversations array', () => {
      const input = [
        {
          conversations: [
            { from: 'human', value: 'Hello' },
            { from: 'gpt', value: 'Hi there!' },
          ],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when conversations field is not an array', () => {
      const input = [{ conversations: 'not-array' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('conversations');
    });

    it('should fail when conversations has invalid from value', () => {
      const input = [
        {
          conversations: [{ from: 'invalid_role', value: 'test' }],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('from');
    });

    it('should pass convertible instruction/output records', () => {
      const input = [{ instruction: 'Hello', output: 'Hi' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });

    it('should fail when no human or assistant fields found', () => {
      const input = [{ randomField: 'value' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('format', () => {
    it('should create ShareGPT records with human/gpt turns', async () => {
      const outputDir = path.join(os.tmpdir(), 'sharegpt-basic');
      const input = [{ instruction: 'What is AI?', output: 'Artificial Intelligence' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'sharegpt',
      });

      expect(result.metadata.formatter).toBe('sharegpt');
      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].conversations[0].from).toBe('human');
      expect(parsed[0].conversations[0].value).toBe('What is AI?');
      expect(parsed[0].conversations[1].from).toBe('gpt');
      expect(parsed[0].conversations[1].value).toBe('Artificial Intelligence');
    });

    it('should handle multi-turn conversations via conversationField', async () => {
      const outputDir = path.join(os.tmpdir(), 'sharegpt-multi');
      const input = [
        { thread: 'A', instruction: 'Hello', output: 'Hi!' },
        { thread: 'A', instruction: 'How are you?', output: 'Good!' },
        { thread: 'B', instruction: 'Bye', output: 'See ya!' },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'sharegpt',
        conversationField: 'thread',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].conversations).toHaveLength(4);
      expect(parsed[1].conversations).toHaveLength(2);
    });

    it('should use humanField and assistantField options', async () => {
      const outputDir = path.join(os.tmpdir(), 'sharegpt-custom-fields');
      const input = [{ question: 'What is 1+1?', answer: '2' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'sharegpt',
        humanField: 'question',
        assistantField: 'answer',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].conversations[0].from).toBe('human');
      expect(parsed[0].conversations[0].value).toBe('What is 1+1?');
      expect(parsed[0].conversations[1].from).toBe('gpt');
      expect(parsed[0].conversations[1].value).toBe('2');
    });

    it('should handle pre-formatted conversations array', async () => {
      const outputDir = path.join(os.tmpdir(), 'sharegpt-preformatted');
      const input = [
        {
          conversations: [
            { from: 'system', value: 'You are helpful' },
            { from: 'human', value: 'Hi' },
            { from: 'gpt', value: 'Hello!' },
          ],
        },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'sharegpt',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].conversations).toHaveLength(3);
      expect(parsed[0].conversations[0].from).toBe('system');
    });

    it('should write both JSON and JSONL files', async () => {
      const outputDir = path.join(os.tmpdir(), 'sharegpt-files');
      const input = [{ instruction: 'Test', output: 'OK' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'sharegpt',
      });

      expect(result.files.all).toHaveLength(2);
      expect(written[path.join(outputDir, 'data.json')]).toBeDefined();
      expect(written[path.join(outputDir, 'data.jsonl')]).toBeDefined();
    });
  });

  describe('formatToShareGPT', () => {
    it('should format data using convenience function', async () => {
      const outputDir = path.join(os.tmpdir(), 'sharegpt-convenience');
      const data = [{ instruction: 'Ping', output: 'Pong' }];
      const result = await formatToShareGPT(data, outputDir);

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('sharegpt');
      expect(result.metadata.counts.total).toBe(1);
    });
  });
});
