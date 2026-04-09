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
  convertBboxCocoToYolo: vi.fn(
    (bbox: [number, number, number, number], imgW: number, imgH: number) => {
      const [x, y, w, h] = bbox;
      return [(x + w / 2) / imgW, (y + h / 2) / imgH, w / imgW, h / imgH];
    }
  ),
}));

import { YOLOFormatter, formatToYOLO } from './yolo';
import { writeData } from '../utils';
import { copyImage, convertBboxCocoToYolo } from './utils';
import fs from 'fs/promises';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('YOLOFormatter.validate', () => {
  const formatter = new YOLOFormatter();

  it('returns error when classField option is missing', () => {
    const data = [{ image: 'photo.jpg', bbox: [10, 20, 100, 50], label: 'cat' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('--class-field');
  });

  it('returns valid for records with image, bbox, and class', () => {
    const data = [{ image: 'photo.jpg', bbox: [10, 20, 100, 50], label: 'cat' }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(true);
    expect(result.stats?.valid).toBe(1);
  });

  it('returns error for missing image field', () => {
    const data = [{ bbox: [10, 20, 100, 50], label: 'cat' }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'image')).toBe(true);
  });

  it('returns error for invalid bbox', () => {
    const data = [{ image: 'photo.jpg', bbox: 'bad', label: 'cat' }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'bbox')).toBe(true);
  });

  it('returns error for missing class field', () => {
    const data = [{ image: 'photo.jpg', bbox: [10, 20, 100, 50] }];
    const result = formatter.validate(data, { classField: 'label' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'label')).toBe(true);
  });
});

describe('YOLOFormatter.format', () => {
  const formatter = new YOLOFormatter();

  it('creates label txt files with class_id cx cy w h format', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [100, 50, 200, 100], label: 'cat', width: 800, height: 600 },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/yolo-out',
      fieldMap: {},
      formatter: 'yolo',
      classField: 'label',
    });

    // writeFile should be called for the label .txt
    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const labelCall = writeFileCalls.find(
      (c) => String(c[0]).endsWith('.txt') && String(c[0]).includes('labels')
    );
    expect(labelCall).toBeDefined();

    // Label content should be: classIdx cx cy w h
    const labelContent = String(labelCall![1]);
    const parts = labelContent.trim().split(' ');
    expect(parts).toHaveLength(5);
    expect(parseInt(parts[0])).toBe(0); // first class index
  });

  it('generates classes.txt with sorted class names', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [10, 20, 100, 50], label: 'dog', width: 800, height: 600 },
      { image: 'img2.jpg', bbox: [30, 40, 80, 60], label: 'cat', width: 800, height: 600 },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/yolo-out',
      fieldMap: {},
      formatter: 'yolo',
      classField: 'label',
    });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const classesCall = writeFileCalls.find((c) => String(c[0]).endsWith('classes.txt'));
    expect(classesCall).toBeDefined();

    const classesContent = String(classesCall![1]);
    const classes = classesContent.split('\n');
    expect(classes).toEqual(['cat', 'dog']); // sorted
  });

  it('normalizes COCO bbox to YOLO format when values > 1', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [100, 50, 200, 100], label: 'cat', width: 800, height: 600 },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/yolo-out',
      fieldMap: {},
      formatter: 'yolo',
      classField: 'label',
    });

    expect(convertBboxCocoToYolo).toHaveBeenCalledWith([100, 50, 200, 100], 800, 600);
  });

  it('writes data.yaml with class info', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [0.3, 0.4, 0.2, 0.1], label: 'cat', width: 800, height: 600 },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/yolo-out',
      fieldMap: {},
      formatter: 'yolo',
      classField: 'label',
    });

    const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
    const yamlCall = writeFileCalls.find((c) => String(c[0]).endsWith('data.yaml'));
    expect(yamlCall).toBeDefined();
    const yamlContent = String(yamlCall![1]);
    expect(yamlContent).toContain('nc: 1');
    expect(yamlContent).toContain("'cat'");
  });

  it('copies images to output images directory', async () => {
    const data = [
      { image: 'img1.jpg', bbox: [100, 50, 200, 100], label: 'cat', width: 800, height: 600 },
    ];

    await formatter.format(data, {
      outputDir: '/tmp/yolo-out',
      fieldMap: {},
      formatter: 'yolo',
      classField: 'label',
    });

    expect(copyImage).toHaveBeenCalled();
  });
});

describe('formatToYOLO', () => {
  it('formats data using convenience function', async () => {
    const data = [
      { image: 'img.jpg', bbox: [10, 20, 100, 50], label: 'cat', width: 800, height: 600 },
    ];

    const result = await formatToYOLO(data, '/tmp/yolo-out', { classField: 'label' });
    expect(result.metadata.formatter).toBe('yolo');
  });
});
