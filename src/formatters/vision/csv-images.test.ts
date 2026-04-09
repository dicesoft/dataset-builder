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
}));

vi.mock('./utils', () => ({
  resolveImagePath: vi.fn((p: string) => `/resolved/${p}`),
  copyImage: vi.fn().mockResolvedValue(undefined),
  DEFAULT_IMAGE_EXTENSIONS: [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.webp',
    '.tiff',
    '.tif',
    '.svg',
  ],
}));

import { CsvImagesFormatter, formatToCsvImages } from './csv-images';
import { writeData } from '../utils';
import { copyImage } from './utils';
import fs from 'fs/promises';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CsvImagesFormatter.validate', () => {
  const formatter = new CsvImagesFormatter();

  it('returns valid for records with image field', () => {
    const data = [{ image: 'photo.jpg', caption: 'A cat' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(true);
    expect(result.stats?.valid).toBe(1);
  });

  it('returns error for missing image field', () => {
    const data = [{ caption: 'No image here' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'image')).toBe(true);
  });

  it('returns error for non-string image field', () => {
    const data = [{ image: 123 }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
  });

  it('uses custom imageField option', () => {
    const data = [{ photo: 'img.jpg', caption: 'test' }];
    const result = formatter.validate(data, { imageField: 'photo' });
    expect(result.valid).toBe(true);
  });

  it('reports stats for mixed valid/invalid records', () => {
    const data = [{ image: 'good.jpg' }, { image: '' }, { image: 'ok.png' }];
    const result = formatter.validate(data);
    expect(result.stats?.valid).toBe(2);
    expect(result.stats?.invalid).toBe(1);
    expect(result.stats?.total).toBe(3);
  });
});

describe('CsvImagesFormatter.format', () => {
  const formatter = new CsvImagesFormatter();

  it('creates CSV output with image paths', async () => {
    const data = [{ image: 'photo.jpg', caption: 'A sunset', tag: 'nature' }];

    const result = await formatter.format(data, {
      outputDir: '/tmp/csv-out',
      fieldMap: {},
      formatter: 'csv-images',
    });

    expect(result.metadata.formatter).toBe('csv-images');
    expect(result.metadata.counts.total).toBe(1);

    // writeData is called for data.csv and data.json
    expect(writeData).toHaveBeenCalled();
    const csvCall = vi.mocked(writeData).mock.calls.find((c) => String(c[0]).endsWith('data.csv'));
    expect(csvCall).toBeDefined();

    const records = csvCall![1] as any[];
    expect(records[0].image_path).toBe('photo.jpg');
    expect(records[0].caption).toBe('A sunset');
  });

  it('copies images when copyMedia is true', async () => {
    const data = [{ image: 'photo.jpg', caption: 'test' }];

    await formatter.format(data, {
      outputDir: '/tmp/csv-out',
      fieldMap: {},
      formatter: 'csv-images',
      copyMedia: true,
    });

    expect(copyImage).toHaveBeenCalled();
    const csvCall = vi.mocked(writeData).mock.calls.find((c) => String(c[0]).endsWith('data.csv'));
    const records = csvCall![1] as any[];
    expect(records[0].image_path).toContain('images/');
  });

  it('respects includeFields option', async () => {
    const data = [{ image: 'photo.jpg', caption: 'test', tag: 'nature', secret: 'hidden' }];

    await formatter.format(data, {
      outputDir: '/tmp/csv-out',
      fieldMap: {},
      formatter: 'csv-images',
      includeFields: ['caption'],
    });

    const csvCall = vi.mocked(writeData).mock.calls.find((c) => String(c[0]).endsWith('data.csv'));
    const records = csvCall![1] as any[];
    expect(records[0].caption).toBe('test');
    expect(records[0].secret).toBeUndefined();
    expect(records[0].tag).toBeUndefined();
  });

  it('respects excludeFields option', async () => {
    const data = [{ image: 'photo.jpg', caption: 'test', secret: 'hidden' }];

    await formatter.format(data, {
      outputDir: '/tmp/csv-out',
      fieldMap: {},
      formatter: 'csv-images',
      excludeFields: ['secret'],
    });

    const csvCall = vi.mocked(writeData).mock.calls.find((c) => String(c[0]).endsWith('data.csv'));
    const records = csvCall![1] as any[];
    expect(records[0].caption).toBe('test');
    expect(records[0].secret).toBeUndefined();
  });

  it('writes data.csv, data.json, and data.jsonl', async () => {
    const data = [{ image: 'photo.jpg', caption: 'test' }];

    const result = await formatter.format(data, {
      outputDir: '/tmp/csv-out',
      fieldMap: {},
      formatter: 'csv-images',
    });

    expect(result.files.all).toHaveLength(3);
    // writeData for csv + json
    expect(writeData).toHaveBeenCalledTimes(2);
    // fs.writeFile for jsonl
    expect(fs.writeFile).toHaveBeenCalled();
  });
});

describe('formatToCsvImages', () => {
  it('formats data using convenience function', async () => {
    const data = [{ image: 'photo.jpg', caption: 'A cat' }];
    const result = await formatToCsvImages(data, '/tmp/csv-out');
    expect(result.metadata.formatter).toBe('csv-images');
    expect(result.metadata.counts.total).toBe(1);
  });
});
