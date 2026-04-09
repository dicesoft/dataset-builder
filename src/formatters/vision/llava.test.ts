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
  estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

vi.mock('./utils', () => ({
  resolveImagePath: vi.fn((p: string) => `/resolved/${p}`),
  validateImage: vi.fn().mockResolvedValue({ valid: true }),
  copyImage: vi.fn().mockResolvedValue(undefined),
  imageToBase64: vi.fn().mockResolvedValue('aGVsbG8='),
}));

import { LLaVAFormatter, formatToLLaVA } from './llava';
import { writeData } from '../utils';
import { imageToBase64, copyImage } from './utils';
import fs from 'fs/promises';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LLaVAFormatter.validate', () => {
  const formatter = new LLaVAFormatter();

  it('returns valid for records with image and conversations', () => {
    const data = [
      {
        image: 'photo.jpg',
        conversations: [
          { from: 'human', value: 'What is this?' },
          { from: 'gpt', value: 'A cat.' },
        ],
      },
    ];
    const result = formatter.validate(data);
    expect(result.valid).toBe(true);
    expect(result.stats?.valid).toBe(1);
  });

  it('returns valid for records with image and instruction/output fields', () => {
    const data = [
      { image: 'photo.jpg', instruction: 'Describe this image', output: 'A cat on a mat' },
    ];
    const result = formatter.validate(data);
    expect(result.valid).toBe(true);
  });

  it('returns errors for missing image field', () => {
    const data = [{ instruction: 'Describe', output: 'Something' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'image')).toBe(true);
  });

  it('returns errors for missing conversations and instruction', () => {
    const data = [{ image: 'photo.jpg' }];
    const result = formatter.validate(data);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('uses custom imageField option', () => {
    const data = [{ photo: 'img.jpg', instruction: 'Describe', output: 'Answer' }];
    const result = formatter.validate(data, { imageField: 'photo' });
    expect(result.valid).toBe(true);
  });
});

describe('LLaVAFormatter.format', () => {
  const formatter = new LLaVAFormatter();

  it('creates LLaVA records with image token prepended', async () => {
    const data = [
      { image: 'photo.jpg', instruction: 'Describe the image', output: 'A beautiful sunset' },
    ];

    const result = await formatter.format(data, {
      outputDir: '/tmp/llava-out',
      fieldMap: {},
      formatter: 'llava',
    });

    expect(result.metadata.formatter).toBe('llava');
    expect(result.metadata.counts.total).toBe(1);

    // Verify writeData was called with data containing <image> token
    const writeCall = vi.mocked(writeData).mock.calls[0];
    const records = writeCall[1] as any[];
    expect(records[0].conversations[0].from).toBe('human');
    expect(records[0].conversations[0].value).toContain('<image>');
    expect(records[0].conversations[1].from).toBe('gpt');
    expect(records[0].image).toBe('photo.jpg');
  });

  it('does not duplicate image token if already present', async () => {
    const data = [
      {
        image: 'photo.jpg',
        instruction: '<image>\nDescribe this',
        output: 'A cat',
      },
    ];

    const result = await formatter.format(data, {
      outputDir: '/tmp/llava-out',
      fieldMap: {},
      formatter: 'llava',
    });

    const writeCall = vi.mocked(writeData).mock.calls[0];
    const records = writeCall[1] as any[];
    // Should not have double <image> tokens
    const humanValue = records[0].conversations[0].value;
    const matches = humanValue.match(/<image>/g);
    expect(matches).toHaveLength(1);
  });

  it('supports embedImages option', async () => {
    const data = [{ image: 'photo.jpg', instruction: 'Describe', output: 'Answer' }];

    await formatter.format(data, {
      outputDir: '/tmp/llava-out',
      fieldMap: {},
      formatter: 'llava',
      embedImages: true,
    });

    expect(imageToBase64).toHaveBeenCalled();
    const writeCall = vi.mocked(writeData).mock.calls[0];
    const records = writeCall[1] as any[];
    expect(records[0].image).toContain('data:image/');
    expect(records[0].image).toContain('base64,');
  });

  it('supports custom imageToken option', async () => {
    const data = [{ image: 'photo.jpg', instruction: 'Describe', output: 'Answer' }];

    await formatter.format(data, {
      outputDir: '/tmp/llava-out',
      fieldMap: {},
      formatter: 'llava',
      imageToken: '[IMG]',
    });

    const writeCall = vi.mocked(writeData).mock.calls[0];
    const records = writeCall[1] as any[];
    expect(records[0].conversations[0].value).toContain('[IMG]');
    expect(records[0].conversations[0].value).not.toContain('<image>');
  });

  it('writes both data.json and data.jsonl files', async () => {
    const data = [{ image: 'photo.jpg', instruction: 'Describe', output: 'Answer' }];

    const result = await formatter.format(data, {
      outputDir: '/tmp/llava-out',
      fieldMap: {},
      formatter: 'llava',
    });

    expect(result.files.all).toHaveLength(2);
    expect(writeData).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalled();
  });
});

describe('formatToLLaVA', () => {
  it('formats data using convenience function', async () => {
    const data = [{ image: 'photo.jpg', instruction: 'What is this?', output: 'A dog' }];

    const result = await formatToLLaVA(data, '/tmp/llava-out');
    expect(result.metadata.formatter).toBe('llava');
    expect(result.metadata.counts.total).toBe(1);
  });
});
