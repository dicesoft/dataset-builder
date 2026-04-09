import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { OASSTFormatter, formatToOASST } from './oasst';

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

describe('OASSTFormatter', () => {
  let formatter: OASSTFormatter;

  beforeEach(() => {
    formatter = new OASSTFormatter();
    for (const key of Object.keys(written)) {
      delete written[key];
    }
  });

  describe('validate', () => {
    it('should pass valid records with messages array and valid roles', () => {
      const input = [
        {
          messages: [
            { role: 'prompter', text: 'Hello' },
            { role: 'assistant', text: 'Hi!' },
          ],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail with invalid role in messages', () => {
      const input = [
        {
          messages: [{ role: 'invalid_role', text: 'Hello' }],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('role');
    });

    it('should fail when messages is not an array', () => {
      const input = [{ messages: 'not-array' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('must be an array');
    });

    it('should fail with empty messages array', () => {
      const input = [{ messages: [] }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('cannot be empty');
    });

    it('should pass records with convertible instruction/output fields', () => {
      const input = [{ instruction: 'Explain AI', output: 'AI stands for...' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });

    it('should fail when no prompt or response field exists', () => {
      const input = [{ randomField: 'test' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should accept content field as alternative to text', () => {
      const input = [
        {
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi' },
          ],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });
  });

  describe('format', () => {
    it('should create OASST tree from instruction/output', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-basic');
      const input = [{ instruction: 'What is AI?', output: 'Artificial Intelligence' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'oasst',
      });

      expect(result.metadata.formatter).toBe('oasst');
      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].message_tree_id).toBeDefined();
      expect(parsed[0].messages).toHaveLength(2);
      expect(parsed[0].messages[0].role).toBe('prompter');
      expect(parsed[0].messages[0].parent_id).toBeNull();
      expect(parsed[0].messages[1].role).toBe('assistant');
      expect(parsed[0].messages[1].parent_id).toBe(parsed[0].messages[0].message_id);
    });

    it('should use treeIdField option', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-treeid');
      const input = [{ thread_id: 'my-tree-1', instruction: 'Hello', output: 'Hi' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'oasst',
        treeIdField: 'thread_id',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].message_tree_id).toBe('my-tree-1');
    });

    it('should include lang option in messages', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-lang');
      const input = [{ instruction: 'Hola', output: 'Hello' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'oasst',
        lang: 'es',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].messages[0].lang).toBe('es');
      expect(parsed[0].messages[1].lang).toBe('es');
    });

    it('should handle pre-formatted messages array', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-preformatted');
      const input = [
        {
          messages: [
            { role: 'user', content: 'Question' },
            { role: 'assistant', content: 'Answer' },
          ],
        },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'oasst',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].messages).toHaveLength(2);
      expect(parsed[0].messages[0].role).toBe('prompter');
      expect(parsed[0].messages[0].text).toBe('Question');
      expect(parsed[0].messages[1].role).toBe('assistant');
    });

    it('should use parentIdField option for custom parent references', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-parentid');
      const input = [
        {
          messages: [
            { role: 'user', content: 'Q1', reply_to: null },
            { role: 'assistant', content: 'A1', reply_to: 'tree_0_msg_0' },
          ],
        },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'oasst',
        parentIdField: 'reply_to',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].messages[0].parent_id).toBeNull();
      expect(parsed[0].messages[1].parent_id).toBe('tree_0_msg_0');
    });

    it('should write both JSON and JSONL files', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-files');
      const input = [{ instruction: 'Test', output: 'OK' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'oasst',
      });

      expect(result.files.all).toHaveLength(2);
      expect(written[path.join(outputDir, 'data.json')]).toBeDefined();
      expect(written[path.join(outputDir, 'data.jsonl')]).toBeDefined();
    });
  });

  describe('formatToOASST', () => {
    it('should format data using convenience function', async () => {
      const outputDir = path.join(os.tmpdir(), 'oasst-convenience');
      const data = [{ instruction: 'Ping', output: 'Pong' }];
      const result = await formatToOASST(data, outputDir);

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('oasst');
      expect(result.metadata.counts.total).toBe(1);
    });
  });
});
