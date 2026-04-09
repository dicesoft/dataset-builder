/**
 * Tests for dataset card generator
 */

import { vi } from 'vitest';
import { generateDatasetCard, writeDatasetCard } from './card';
import type { DatasetCardOptions } from './card';

// Mock fs/promises for writeDatasetCard
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
}));

describe('huggingface/card', () => {
  describe('generateDatasetCard', () => {
    const baseOptions: DatasetCardOptions = {
      datasetName: 'my-dataset',
    };

    it('should return markdown string with YAML frontmatter', () => {
      const card = generateDatasetCard(baseOptions);
      expect(card).toContain('---');
      expect(card).toContain('# my-dataset');
      expect(card).toContain('## Usage');
      expect(card).toContain('load_dataset');
    });

    it('should include license, task categories, and language', () => {
      const card = generateDatasetCard({
        ...baseOptions,
        license: 'mit',
        taskCategories: ['text-generation'],
        language: ['en'],
      });
      expect(card).toContain('license: mit');
      expect(card).toContain('task_categories:');
      expect(card).toContain('- text-generation');
      expect(card).toContain('language:');
      expect(card).toContain('- en');
    });

    it('should include dataset statistics', () => {
      const card = generateDatasetCard({
        ...baseOptions,
        totalExamples: 1000,
        formatter: 'alpaca',
      });
      expect(card).toContain('## Dataset Structure');
      expect(card).toContain('### Statistics');
      expect(card).toContain('1,000');
      expect(card).toContain('alpaca');
    });

    it('should include splits info in table', () => {
      const card = generateDatasetCard({
        ...baseOptions,
        splits: [
          { name: 'train', numExamples: 800 },
          { name: 'validation', numExamples: 100 },
          { name: 'test', numExamples: 100 },
        ],
      });
      expect(card).toContain('### Splits');
      expect(card).toContain('| train |');
      expect(card).toContain('| validation |');
      expect(card).toContain('| test |');
    });

    it('should include features table', () => {
      const card = generateDatasetCard({
        ...baseOptions,
        features: {
          text: 'string',
          id: 'int32',
        },
      });
      expect(card).toContain('### Features');
      expect(card).toContain('| text | string |');
      expect(card).toContain('| id | int32 |');
    });
  });

  describe('writeDatasetCard', () => {
    it('should write README.md file', async () => {
      const fs = await import('fs/promises');
      const cardPath = await writeDatasetCard('/output/dir', {
        datasetName: 'test-dataset',
      });
      expect(cardPath).toContain('README.md');
      expect(fs.default.writeFile).toHaveBeenCalled();
    });
  });
});
