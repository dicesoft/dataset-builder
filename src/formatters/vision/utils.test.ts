import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
    copyFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock('../utils', () => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
  fileExists: vi.fn().mockResolvedValue(true),
}));

import fs from 'fs/promises';
import { fileExists } from '../utils';
import {
  resolveImagePath,
  validateImage,
  imageToBase64,
  convertBboxCocoToYolo,
  convertBboxYoloToCoco,
  getRelativeImagePath,
  batchValidateImages,
  DEFAULT_IMAGE_EXTENSIONS,
} from './utils';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DEFAULT_IMAGE_EXTENSIONS', () => {
  it('contains common image extensions', () => {
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.jpg');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.jpeg');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.png');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.gif');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.bmp');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.webp');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.tiff');
    expect(DEFAULT_IMAGE_EXTENSIONS).toContain('.svg');
  });
});

describe('resolveImagePath', () => {
  it('returns absolute path unchanged', () => {
    const absPath = path.resolve('/images/cat.jpg');
    expect(resolveImagePath(absPath)).toBe(absPath);
  });

  it('resolves relative path with basePath', () => {
    const result = resolveImagePath('cat.jpg', '/data/images');
    expect(result).toBe(path.resolve('/data/images', 'cat.jpg'));
  });

  it('resolves relative path with cwd when no basePath', () => {
    const result = resolveImagePath('cat.jpg');
    expect(result).toBe(path.resolve(process.cwd(), 'cat.jpg'));
  });
});

describe('validateImage', () => {
  it('returns valid for a supported extension when file exists', async () => {
    vi.mocked(fileExists).mockResolvedValue(true);
    const result = await validateImage('/images/photo.jpg');
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid for unsupported extension', async () => {
    const result = await validateImage('/images/data.txt');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported image extension');
  });

  it('returns invalid when file does not exist', async () => {
    vi.mocked(fileExists).mockResolvedValue(false);
    const result = await validateImage('/images/missing.jpg');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('accepts custom allowed extensions', async () => {
    vi.mocked(fileExists).mockResolvedValue(true);
    const result = await validateImage('/images/data.raw', ['.raw']);
    expect(result).toEqual({ valid: true });
  });

  it('rejects valid default extension if not in custom allowedExts', async () => {
    const result = await validateImage('/images/photo.jpg', ['.raw']);
    expect(result.valid).toBe(false);
  });
});

describe('convertBboxCocoToYolo', () => {
  it('converts COCO [x,y,w,h] to YOLO [cx,cy,w,h] normalized', () => {
    // COCO: x=100, y=50, w=200, h=100, image 800x600
    const result = convertBboxCocoToYolo([100, 50, 200, 100], 800, 600);
    // cx = (100 + 100) / 800 = 0.25
    // cy = (50 + 50) / 600 = 0.1667
    // nw = 200 / 800 = 0.25
    // nh = 100 / 600 = 0.1667
    expect(result[0]).toBeCloseTo(0.25, 4);
    expect(result[1]).toBeCloseTo(1 / 6, 4);
    expect(result[2]).toBeCloseTo(0.25, 4);
    expect(result[3]).toBeCloseTo(1 / 6, 4);
  });

  it('handles bbox at origin', () => {
    const result = convertBboxCocoToYolo([0, 0, 100, 100], 100, 100);
    // cx = (0 + 50) / 100 = 0.5, cy = 0.5, nw = 1, nh = 1
    expect(result).toEqual([0.5, 0.5, 1, 1]);
  });
});

describe('convertBboxYoloToCoco', () => {
  it('converts YOLO [cx,cy,w,h] to COCO [x,y,w,h] absolute', () => {
    const result = convertBboxYoloToCoco([0.5, 0.5, 0.5, 0.5], 800, 600);
    // w = 0.5*800 = 400, h = 0.5*600 = 300
    // x = 0.5*800 - 200 = 200, y = 0.5*600 - 150 = 150
    expect(result[0]).toBeCloseTo(200, 4);
    expect(result[1]).toBeCloseTo(150, 4);
    expect(result[2]).toBeCloseTo(400, 4);
    expect(result[3]).toBeCloseTo(300, 4);
  });

  it('round-trips with convertBboxCocoToYolo', () => {
    const original: [number, number, number, number] = [100, 50, 200, 100];
    const yolo = convertBboxCocoToYolo(original, 800, 600);
    const coco = convertBboxYoloToCoco(yolo, 800, 600);
    expect(coco[0]).toBeCloseTo(original[0], 4);
    expect(coco[1]).toBeCloseTo(original[1], 4);
    expect(coco[2]).toBeCloseTo(original[2], 4);
    expect(coco[3]).toBeCloseTo(original[3], 4);
  });
});

describe('getRelativeImagePath', () => {
  it('computes relative path from outputDir', () => {
    const imgPath = path.join('/output', 'images', 'cat.jpg');
    const outputDir = '/output';
    const result = getRelativeImagePath(imgPath, outputDir);
    expect(result).toBe('images/cat.jpg');
  });

  it('uses forward slashes for cross-platform compatibility', () => {
    const imgPath = path.join('/output', 'sub', 'dir', 'img.png');
    const result = getRelativeImagePath(imgPath, '/output');
    expect(result).toBe('sub/dir/img.png');
    expect(result).not.toContain('\\');
  });
});

describe('imageToBase64', () => {
  it('reads file and returns base64 string', async () => {
    const content = Buffer.from('fake-image-data');
    vi.mocked(fs.stat).mockResolvedValue({ size: content.length } as any);
    vi.mocked(fs.readFile).mockResolvedValue(content);

    const result = await imageToBase64('/images/photo.jpg');
    expect(result).toBe(content.toString('base64'));
  });

  it('returns null when file exceeds maxSizeBytes', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 20_000_000 } as any);

    const result = await imageToBase64('/images/photo.jpg', 10_000_000);
    expect(result).toBeNull();
  });

  it('returns null on file read error', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

    const result = await imageToBase64('/images/missing.jpg');
    expect(result).toBeNull();
  });
});

describe('batchValidateImages', () => {
  it('separates valid and invalid records', async () => {
    vi.mocked(fileExists).mockResolvedValue(true);

    const data = [{ image: 'valid.jpg' }, { image: '' }, { noimage: 'test' }];

    const result = await batchValidateImages(data, 'image');
    expect(result.validIndices).toContain(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[1].index).toBe(2);
  });

  it('reports missing image field', async () => {
    const data = [{ name: 'no image field' }];
    const result = await batchValidateImages(data, 'image');
    expect(result.validIndices).toHaveLength(0);
    expect(result.errors[0].error).toContain('Missing image field');
  });

  it('validates all records as valid when images exist', async () => {
    vi.mocked(fileExists).mockResolvedValue(true);

    const data = [{ image: 'a.jpg' }, { image: 'b.png' }];

    const result = await batchValidateImages(data, 'image');
    expect(result.validIndices).toEqual([0, 1]);
    expect(result.errors).toHaveLength(0);
  });
});
