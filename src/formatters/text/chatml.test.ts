import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { ChatMLFormatter, formatToChatML } from './chatml';

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

describe('ChatMLFormatter', () => {
  let formatter: ChatMLFormatter;

  beforeEach(() => {
    formatter = new ChatMLFormatter();
    for (const key of Object.keys(written)) {
      delete written[key];
    }
  });

  describe('validate', () => {
    it('should pass valid records with messages array', () => {
      const input = [
        {
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail with empty messages array', () => {
      const input = [{ messages: [] }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('cannot be empty');
    });

    it('should fail with invalid messages (not array)', () => {
      const input = [{ messages: 'not-an-array' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
    });

    it('should fail with invalid message role', () => {
      const input = [
        {
          messages: [{ role: 'unknown_role', content: 'Hello' }],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('role');
    });

    it('should pass convertible instruction/output fields without messages', () => {
      const input = [{ instruction: 'What is AI?', output: 'Artificial Intelligence' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });

    it('should fail when no convertible fields and no messages', () => {
      const input = [{ randomField: 'value' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should accept messages as JSON string', () => {
      const messages = JSON.stringify([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]);
      const input = [{ messages }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
    });
  });

  describe('format', () => {
    it('should create ChatML records from instruction/output fields', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-basic');
      const input = [{ instruction: 'What is 2+2?', output: '4' }];
      const result = await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'chatml',
        includeSystem: true,
      });

      expect(result.metadata.formatter).toBe('chatml');
      expect(result.metadata.counts.total).toBe(1);

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].messages).toBeDefined();
      const roles = parsed[0].messages.map((m: { role: string }) => m.role);
      expect(roles).toContain('user');
      expect(roles).toContain('assistant');
    });

    it('should include system message from systemPrompt option', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-system');
      const input = [{ instruction: 'Hello', output: 'Hi' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'chatml',
        includeSystem: true,
        systemPrompt: 'You are a helpful assistant.',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].messages[0].role).toBe('system');
      expect(parsed[0].messages[0].content).toBe('You are a helpful assistant.');
    });

    it('should exclude system message when includeSystem is false', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-no-system');
      const input = [{ instruction: 'Hello', system: 'Be polite', output: 'Hi' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'chatml',
        includeSystem: false,
        systemPrompt: 'You are a helpful assistant.',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      const roles = parsed[0].messages.map((m: { role: string }) => m.role);
      expect(roles).not.toContain('system');
    });

    it('should use roleMap to map custom field names', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-rolemap');
      const input = [{ question: 'What is AI?', answer: 'Artificial Intelligence' }];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'chatml',
        includeSystem: true,
        roleMap: { user: 'question', assistant: 'answer' },
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(
        parsed[0].messages.some(
          (m: { role: string; content: string }) => m.role === 'user' && m.content === 'What is AI?'
        )
      ).toBe(true);
      expect(
        parsed[0].messages.some(
          (m: { role: string; content: string }) =>
            m.role === 'assistant' && m.content === 'Artificial Intelligence'
        )
      ).toBe(true);
    });

    it('should group records by conversationIdField', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-conv-id');
      const input = [
        { conv_id: 'A', instruction: 'Hello', output: 'Hi!' },
        { conv_id: 'A', instruction: 'How are you?', output: 'Good!' },
        { conv_id: 'B', instruction: 'Bye', output: 'Goodbye!' },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'chatml',
        includeSystem: true,
        conversationIdField: 'conv_id',
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].messages.length).toBe(4);
      expect(parsed[1].messages.length).toBe(2);
    });

    it('should handle pre-formatted messages array', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-preformatted');
      const input = [
        {
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'What?' },
            { role: 'assistant', content: 'I help!' },
          ],
        },
      ];
      await formatter.format(input, {
        outputDir,
        fieldMap: {},
        formatter: 'chatml',
        includeSystem: true,
      });

      const parsed = JSON.parse(written[path.join(outputDir, 'data.json')]);
      expect(parsed[0].messages).toHaveLength(3);
      expect(parsed[0].messages[0].role).toBe('system');
    });
  });

  describe('formatToChatML', () => {
    it('should format data using convenience function', async () => {
      const outputDir = path.join(os.tmpdir(), 'chatml-convenience');
      const data = [{ instruction: 'Test', output: 'Result' }];
      const result = await formatToChatML(data, outputDir);

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('chatml');
      expect(result.metadata.counts.total).toBe(1);
    });
  });
});
