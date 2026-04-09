import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COCOSegFormatter } from './coco-seg';
import type { COCOSegOptions } from '../types';
import path from 'path';

// Mock fs and utils
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
    access: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('[]'),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 100 }),
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('[]'),
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeData: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('./utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils')>();
  return {
    ...actual,
    resolveImagePath: vi.fn((p: string) => p),
    copyImage: vi.fn().mockResolvedValue(undefined),
  };
});

describe('COCOSegFormatter', () => {
  const formatter = new COCOSegFormatter();

  it('should have correct name', () => {
    expect(formatter.name).toBe('coco-seg');
  });

  describe('validate', () => {
    it('should pass valid records', () => {
      const input = [
        {
          image: 'test.jpg',
          mask_path: 'masks/test_0.png',
          category: 'cat',
          bbox: [10, 20, 30, 40],
        },
      ];
      const result = formatter.validate(input);
      expect(result.valid).toBe(true);
      expect(result.stats?.valid).toBe(1);
    });

    it('should fail on missing image', () => {
      const input = [{ mask_path: 'masks/test_0.png', category: 'cat' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
    });

    it('should fail on missing mask_path', () => {
      const input = [{ image: 'test.jpg', category: 'cat' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
    });

    it('should fail on missing category', () => {
      const input = [{ image: 'test.jpg', mask_path: 'masks/test_0.png' }];
      const result = formatter.validate(input);
      expect(result.valid).toBe(false);
    });
  });

  describe('format', () => {
    it('should produce correct COCO-seg output structure', async () => {
      const input = [
        {
          image: 'images/cat.jpg',
          mask_path: 'masks/cat_0.png',
          category: 'cat',
          bbox: [10, 20, 100, 150],
          area: 15000,
          image_width: 800,
          image_height: 600,
        },
        {
          image: 'images/cat.jpg',
          mask_path: 'masks/cat_1.png',
          category: 'cat',
          bbox: [200, 100, 80, 90],
          area: 7200,
          image_width: 800,
          image_height: 600,
        },
        {
          image: 'images/dog.jpg',
          mask_path: 'masks/dog_0.png',
          category: 'dog',
          bbox: [50, 50, 200, 300],
          area: 60000,
          image_width: 640,
          image_height: 480,
        },
      ];

      const options: COCOSegOptions = {
        outputDir: '/tmp/test-coco-seg',
        fieldMap: {},
        formatter: 'coco-seg',
      };

      const result = await formatter.format(input, options);

      expect(result.metadata.formatter).toBe('coco-seg');
      expect(result.metadata.counts.total).toBe(3);
      expect(result.files.all).toBeDefined();
      expect(result.files.all!.length).toBeGreaterThan(0);
    });
  });
});
