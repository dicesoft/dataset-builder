import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YOLOSegFormatter } from './yolo-seg';
import type { YOLOSegOptions } from '../types';

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

vi.mock('../../transformer/python-runner', () => ({
  runPythonScript: vi.fn().mockResolvedValue({
    success: true,
    output: '',
    error: '',
    jsonOutput: {
      points: [
        [0.1, 0.2],
        [0.3, 0.2],
        [0.3, 0.5],
        [0.1, 0.5],
      ],
    },
  }),
}));

describe('YOLOSegFormatter', () => {
  const formatter = new YOLOSegFormatter();

  it('should have correct name', () => {
    expect(formatter.name).toBe('yolo-seg');
  });

  describe('validate', () => {
    it('should require --class-field option', () => {
      const input = [{ image: 'test.jpg', mask_path: 'masks/test_0.png' }];
      const result = formatter.validate(input, {});
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('--class-field');
    });

    it('should pass valid records', () => {
      const input = [{ image: 'test.jpg', mask_path: 'masks/test_0.png', category: 'cat' }];
      const result = formatter.validate(input, { classField: 'category' });
      expect(result.valid).toBe(true);
    });

    it('should fail on missing image', () => {
      const input = [{ mask_path: 'masks/test_0.png', category: 'cat' }];
      const result = formatter.validate(input, { classField: 'category' });
      expect(result.valid).toBe(false);
    });

    it('should fail on missing mask_path', () => {
      const input = [{ image: 'test.jpg', category: 'cat' }];
      const result = formatter.validate(input, { classField: 'category' });
      expect(result.valid).toBe(false);
    });

    it('should fail on missing class field', () => {
      const input = [{ image: 'test.jpg', mask_path: 'masks/test_0.png' }];
      const result = formatter.validate(input, { classField: 'category' });
      expect(result.valid).toBe(false);
    });
  });

  describe('format', () => {
    it('should produce YOLO-seg output structure', async () => {
      const input = [
        {
          image: 'images/cat.jpg',
          mask_path: '/masks/cat_0.png',
          category: 'cat',
          image_width: 800,
          image_height: 600,
        },
        {
          image: 'images/dog.jpg',
          mask_path: '/masks/dog_0.png',
          category: 'dog',
          image_width: 640,
          image_height: 480,
        },
      ];

      const options: YOLOSegOptions = {
        outputDir: '/tmp/test-yolo-seg',
        fieldMap: {},
        formatter: 'yolo-seg',
        classField: 'category',
      };

      const result = await formatter.format(input, options);

      expect(result.metadata.formatter).toBe('yolo-seg');
      expect(result.files.all).toBeDefined();
      // Should include classes.txt, data.yaml, data.json, data.jsonl
      expect(result.files.all!.length).toBeGreaterThanOrEqual(4);
    });
  });
});
