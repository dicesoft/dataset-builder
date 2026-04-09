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
  validateImage: vi.fn().mockResolvedValue({ valid: true }),
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

import { ImageFolderFormatter, formatToImageFolder } from './imagefolder';
import { writeData, ensureDir } from '../utils';
import { copyImage } from './utils';
import fs from 'fs/promises';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageFolderFormatter.validate', () => {
  const formatter = new ImageFolderFormatter();

  it('returns error when classField option is missing', () => {
    const data = [{ image: 'photo.jpg', label: 'cat' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('--class-field');
  });

  it('returns valid for records with image and classField', () => {
    const data = [{ image: 'photo.jpg', label: 'cat' }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(true);
    expect(result.stats?.valid).toBe(1);
  });

  it('returns error for missing image field', () => {
    const data = [{ label: 'cat' }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'image')).toBe(true);
  });

  it('returns error for missing class field', () => {
    const data = [{ image: 'photo.jpg' }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'label')).toBe(true);
  });
});

describe('ImageFolderFormatter.format', () => {
  const formatter = new ImageFolderFormatter();

  it('creates class-based folder structure and copies images', async () => {
    const data = [
      { image: 'cat1.jpg', label: 'cat' },
      { image: 'dog1.jpg', label: 'dog' },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/imagefolder-out',
      fieldMap: {},
      formatter: 'imagefolder',
      classField: 'label',
    });

    // ensureDir should be called for class directories
    const ensureDirCalls = vi.mocked(ensureDir).mock.calls.map((c) => String(c[0]));
    expect(ensureDirCalls.some((d) => d.includes('cat'))).toBe(true);
    expect(ensureDirCalls.some((d) => d.includes('dog'))).toBe(true);

    // copyImage should be called for each image
    expect(copyImage).toHaveBeenCalledTimes(2);
  });

  it('generates metadata records with file_name and label', async () => {
    const data = [{ image: 'photo.jpg', label: 'cat', extra: 'info' }];

    await formatter.format(data, {
      outputDir: '/tmp/imagefolder-out',
      fieldMap: {},
      formatter: 'imagefolder',
      classField: 'label',
    });

    // writeData is called for metadata.csv, data.json
    const writeDataCalls = vi.mocked(writeData).mock.calls;
    // First call should be metadata.csv
    const metadataCall = writeDataCalls.find((c) => String(c[0]).includes('metadata.csv'));
    expect(metadataCall).toBeDefined();

    const records = metadataCall![1] as any[];
    expect(records[0].file_name).toBe('cat/photo.jpg');
    expect(records[0].label).toBe('cat');
    expect(records[0].extra).toBe('info');
  });

  it('skips files with unsupported extensions', async () => {
    const data = [
      { image: 'photo.jpg', label: 'cat' },
      { image: 'data.txt', label: 'cat' },
    ];

    const result = await formatter.format(data, {
      outputDir: '/tmp/imagefolder-out',
      fieldMap: {},
      formatter: 'imagefolder',
      classField: 'label',
    });

    expect(result.metadata.counts.total).toBe(1);
  });

  it('supports custom imageExtensions', async () => {
    const data = [{ image: 'photo.raw', label: 'cat' }];

    const result = await formatter.format(data, {
      outputDir: '/tmp/imagefolder-out',
      fieldMap: {},
      formatter: 'imagefolder',
      classField: 'label',
      imageExtensions: ['.raw'],
    });

    expect(result.metadata.counts.total).toBe(1);
    expect(copyImage).toHaveBeenCalledTimes(1);
  });

  it('handles filename collisions', async () => {
    const data = [
      { image: 'photo.jpg', label: 'cat' },
      { image: 'photo.jpg', label: 'cat' },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/imagefolder-out',
      fieldMap: {},
      formatter: 'imagefolder',
      classField: 'label',
    });

    // copyImage should be called twice with different dest names
    expect(copyImage).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(copyImage).mock.calls;
    const dest1 = String(calls[0][1]);
    const dest2 = String(calls[1][1]);
    expect(dest1).not.toBe(dest2);
  });
});

describe('formatToImageFolder', () => {
  it('formats data using convenience function', async () => {
    const data = [{ image: 'photo.jpg', label: 'cat' }];
    const result = await formatToImageFolder(data, '/tmp/imagefolder-out', { classField: 'label' });
    expect(result.metadata.formatter).toBe('imagefolder');
  });
});
