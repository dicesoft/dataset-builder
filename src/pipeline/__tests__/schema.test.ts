import { describe, it, expect } from 'vitest';
import { pipelineConfigSchema, pipelineStepSchema } from '../schema';

describe('pipeline schema', () => {
  describe('valid configs', () => {
    it('should accept a valid pipeline with a generate step', () => {
      const config = {
        name: 'test-pipeline',
        steps: [
          {
            name: 'Generate people',
            type: 'generate',
            options: { type: 'person', count: 100, locale: 'en' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept a valid pipeline with a scrape step', () => {
      const config = {
        name: 'scrape-pipeline',
        steps: [
          {
            name: 'Scrape site',
            type: 'scrape',
            options: { url: 'https://example.com', spider: 'basic', depth: 2 },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept a valid pipeline with an import step', () => {
      const config = {
        name: 'import-pipeline',
        steps: [
          {
            name: 'Import CSV',
            type: 'import',
            options: { filePath: '/data/input.csv', delimiter: ';' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept a valid pipeline with a clean step', () => {
      const config = {
        name: 'clean-pipeline',
        steps: [
          {
            name: 'Clean data',
            type: 'clean',
            options: { dedupe: true, trim: true, removeEmpty: true },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept a valid pipeline with an export step', () => {
      const config = {
        name: 'export-pipeline',
        steps: [
          {
            name: 'Export JSON',
            type: 'export',
            options: { output: '/data/output.json', format: 'jsonl', pretty: true },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept a valid pipeline with a format step', () => {
      const config = {
        name: 'format-pipeline',
        steps: [
          {
            name: 'Format as Alpaca',
            type: 'format',
            options: {
              outputDir: '/data/formatted',
              formatter: 'alpaca',
              fieldMap: { instruction: 'question', output: 'answer' },
              seed: 42,
            },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept a multi-step pipeline', () => {
      const config = {
        name: 'full-pipeline',
        steps: [
          {
            name: 'Import data',
            type: 'import',
            options: { filePath: '/data/input.json' },
          },
          {
            name: 'Clean data',
            type: 'clean',
            options: { dedupe: true },
          },
          {
            name: 'Export data',
            type: 'export',
            options: { output: '/data/clean.json' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply default values for optional fields', () => {
      const config = {
        name: 'defaults-test',
        steps: [
          {
            name: 'Generate',
            type: 'generate',
            options: {},
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        const step = result.data.steps[0];
        if (step.type === 'generate') {
          expect(step.options.type).toBe('person');
          expect(step.options.count).toBe(10);
          expect(step.options.locale).toBe('en');
        }
      }
    });
  });

  describe('invalid configs', () => {
    it('should reject config without name', () => {
      const config = {
        steps: [
          {
            name: 'Step',
            type: 'generate',
            options: { type: 'person' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject config with empty steps', () => {
      const config = {
        name: 'empty',
        steps: [],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject config without steps', () => {
      const config = { name: 'no-steps' };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject unknown step type', () => {
      const config = {
        name: 'bad-type',
        steps: [
          {
            name: 'Bad step',
            type: 'unknown-type',
            options: {},
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject step without name', () => {
      const config = {
        name: 'no-step-name',
        steps: [
          {
            type: 'generate',
            options: { type: 'person' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject generate step with negative count', () => {
      const config = {
        name: 'bad-count',
        steps: [
          {
            name: 'Generate',
            type: 'generate',
            options: { count: -5 },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject scrape step with depth less than 1', () => {
      const config = {
        name: 'bad-depth',
        steps: [
          {
            name: 'Scrape',
            type: 'scrape',
            options: { url: 'https://example.com', depth: 0 },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject export step with invalid format', () => {
      const config = {
        name: 'bad-format',
        steps: [
          {
            name: 'Export',
            type: 'export',
            options: { output: '/out.txt', format: 'xml' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should provide error details on invalid config', () => {
      const config = {
        name: 'error-details',
        steps: [
          {
            name: 'Bad step',
            type: 'generate',
            options: { count: 'not-a-number' },
          },
        ],
      };
      const result = pipelineConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('step schema', () => {
    it('should validate individual steps', () => {
      const step = {
        name: 'Import CSV',
        type: 'import',
        options: { filePath: '/data/test.csv' },
      };
      const result = pipelineStepSchema.safeParse(step);
      expect(result.success).toBe(true);
    });
  });
});
