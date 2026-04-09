import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    copyFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeData: vi.fn().mockResolvedValue(undefined),
  getFieldValue: vi.fn((obj: Record<string, unknown>, field: string) => {
    const parts = field.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }),
}));

vi.mock('./utils', () => ({
  resolveImagePath: vi.fn((p: string) => `/resolved/${p}`),
  copyImage: vi.fn().mockResolvedValue(undefined),
}));

import { COCOFormatter, formatToCOCO } from './coco';
import { writeData } from '../utils';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('COCOFormatter.validate', () => {
  const formatter = new COCOFormatter();

  it('returns valid for records with image, bbox, and category', () => {
    const data = [{ image: 'photo.jpg', bbox: [10, 20, 100, 50], category: 'cat' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(true);
    expect(result.stats?.valid).toBe(1);
  });

  it('returns error for missing image field', () => {
    const data = [{ bbox: [10, 20, 100, 50], category: 'cat' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'image')).toBe(true);
  });

  it('returns error for invalid bbox', () => {
    const data = [{ image: 'photo.jpg', bbox: 'not-an-array', category: 'cat' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'bbox')).toBe(true);
  });

  it('returns error for missing category', () => {
    const data = [{ image: 'photo.jpg', bbox: [10, 20, 100, 50] }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'category')).toBe(true);
  });

  it('supports custom bboxField and categoryNameField options', () => {
    const data = [{ image: 'photo.jpg', bounding_box: [10, 20, 100, 50], label: 'dog' }];
    const result = formatter.validate(data, {
      bboxField: 'bounding_box',
      categoryNameField: 'label',
    });
    expect(result.valid).toBe(true);
  });
});

describe('COCOFormatter.format', () => {
  const formatter = new COCOFormatter();

  it('creates COCO annotations JSON structure', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [10, 20, 100, 50], category: 'cat', width: 640, height: 480 },
      { image: 'img2.jpg', bbox: [30, 40, 80, 60], category: 'dog', width: 800, height: 600 },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/coco-out',
      fieldMap: {},
      formatter: 'coco',
    });

    // First call to writeData is annotations.json
    const annoCall = vi.mocked(writeData).mock.calls[0];
    const cocoData = annoCall[1] as any;

    expect(cocoData.images).toHaveLength(2);
    expect(cocoData.annotations).toHaveLength(2);
    expect(cocoData.categories).toHaveLength(2);

    // Check category names
    const categoryNames = cocoData.categories.map((c: any) => c.name);
    expect(categoryNames).toContain('cat');
    expect(categoryNames).toContain('dog');
  });

  it('generates unique sequential annotation IDs', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [10, 20, 100, 50], category: 'cat' },
      { image: 'img1.jpg', bbox: [30, 40, 80, 60], category: 'dog' },
      { image: 'img2.jpg', bbox: [5, 10, 50, 30], category: 'cat' },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/coco-out',
      fieldMap: {},
      formatter: 'coco',
    });

    const annoCall = vi.mocked(writeData).mock.calls[0];
    const cocoData = annoCall[1] as any;
    const ids = cocoData.annotations.map((a: any) => a.id);

    expect(ids).toEqual([1, 2, 3]);
  });

  it('deduplicates categories', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [10, 20, 100, 50], category: 'cat' },
      { image: 'img2.jpg', bbox: [30, 40, 80, 60], category: 'cat' },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/coco-out',
      fieldMap: {},
      formatter: 'coco',
    });

    const annoCall = vi.mocked(writeData).mock.calls[0];
    const cocoData = annoCall[1] as any;
    expect(cocoData.categories).toHaveLength(1);
    expect(cocoData.categories[0].name).toBe('cat');
  });

  it('deduplicates images by file path', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [10, 20, 100, 50], category: 'cat' },
      { image: 'img1.jpg', bbox: [30, 40, 80, 60], category: 'dog' },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/coco-out',
      fieldMap: {},
      formatter: 'coco',
    });

    const annoCall = vi.mocked(writeData).mock.calls[0];
    const cocoData = annoCall[1] as any;
    expect(cocoData.images).toHaveLength(1);
    expect(cocoData.annotations).toHaveLength(2);
    // Both annotations should reference the same image
    expect(cocoData.annotations[0].image_id).toBe(cocoData.annotations[1].image_id);
  });

  it('computes annotation area from bbox width * height', async () => {
    const data = [{ image: 'img1.jpg', bbox: [10, 20, 100, 50], category: 'cat' }];

    await formatter.format(data, {
      outputDir: '/tmp/coco-out',
      fieldMap: {},
      formatter: 'coco',
    });

    const annoCall = vi.mocked(writeData).mock.calls[0];
    const cocoData = annoCall[1] as any;
    expect(cocoData.annotations[0].area).toBe(5000); // 100 * 50
  });
});

describe('formatToCOCO', () => {
  it('formats data using convenience function', async () => {
    const data = [{ image: 'img.jpg', bbox: [10, 20, 100, 50], category: 'cat' }];

    const result = await formatToCOCO(data, '/tmp/coco-out');
    expect(result.metadata.formatter).toBe('coco');
    expect(result.metadata.counts.total).toBe(1);
  });
});
