/**
 * Tests for audio utility functions
 */

import path from 'path';
import { vi } from 'vitest';
import {
  resolveAudioPath,
  validateAudio,
  DEFAULT_AUDIO_EXTENSIONS,
  getRelativeAudioPath,
  getAudioMetadata,
  batchValidateAudio,
} from './utils';

// Mock the formatters/utils module (fileExists)
vi.mock('../utils', () => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
  fileExists: vi.fn().mockResolvedValue(true),
}));

// Mock child_process for ffprobe
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify: (fn: unknown) => {
      // Return a mock async function for execFile
      return vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          streams: [{ duration: '12.5', sample_rate: '44100' }],
        }),
      });
    },
  };
});

import { fileExists } from '../utils';

describe('audio/utils', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveAudioPath', () => {
    it('should return absolute paths unchanged', () => {
      const absPath = path.resolve('/some/absolute/path/audio.wav');
      expect(resolveAudioPath(absPath)).toBe(absPath);
    });

    it('should resolve relative paths with basePath', () => {
      const basePath = path.resolve('/base/dir');
      const result = resolveAudioPath('audio/file.wav', basePath);
      expect(result).toBe(path.resolve(basePath, 'audio/file.wav'));
    });

    it('should resolve relative paths with cwd when no basePath', () => {
      const result = resolveAudioPath('audio/file.wav');
      expect(result).toBe(path.resolve(process.cwd(), 'audio/file.wav'));
    });
  });

  describe('validateAudio', () => {
    it('should accept valid audio extensions', async () => {
      const validExts = ['.wav', '.mp3', '.flac', '.ogg'];
      for (const ext of validExts) {
        const result = await validateAudio(`/path/to/file${ext}`);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject invalid audio extensions', async () => {
      const result = await validateAudio('/path/to/file.txt');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported audio extension');
    });

    it('should report file not found when fileExists returns false', async () => {
      vi.mocked(fileExists).mockResolvedValueOnce(false);
      const result = await validateAudio('/path/to/missing.wav');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should accept custom allowed extensions', async () => {
      const result = await validateAudio('/path/to/file.custom', ['.custom']);
      expect(result.valid).toBe(true);
    });
  });

  describe('DEFAULT_AUDIO_EXTENSIONS', () => {
    it('should contain expected audio extensions', () => {
      expect(DEFAULT_AUDIO_EXTENSIONS).toContain('.wav');
      expect(DEFAULT_AUDIO_EXTENSIONS).toContain('.mp3');
      expect(DEFAULT_AUDIO_EXTENSIONS).toContain('.flac');
      expect(DEFAULT_AUDIO_EXTENSIONS).toContain('.ogg');
      expect(DEFAULT_AUDIO_EXTENSIONS).toContain('.m4a');
      expect(DEFAULT_AUDIO_EXTENSIONS).toContain('.aac');
    });
  });

  describe('getRelativeAudioPath', () => {
    it('should compute relative path with forward slashes', () => {
      const audioPath = path.join('/output', 'audio', 'file.wav');
      const outputDir = path.resolve('/output');
      const result = getRelativeAudioPath(audioPath, outputDir);
      expect(result).toBe('audio/file.wav');
      expect(result).not.toContain('\\');
    });
  });

  describe('getAudioMetadata', () => {
    it('should extract duration and sample rate from ffprobe output', async () => {
      const metadata = await getAudioMetadata('/path/to/audio.wav');
      expect(metadata.duration).toBe(12.5);
      expect(metadata.sampleRate).toBe(44100);
    });
  });

  describe('batchValidateAudio', () => {
    it('should separate valid and invalid records', async () => {
      const data = [
        { audio: '/path/to/file.wav' },
        { audio: '/path/to/file.txt' },
        { notAudio: 'missing field' },
      ];

      const result = await batchValidateAudio(data, 'audio');
      expect(result.validIndices).toContain(0);
      expect(result.errors.length).toBeGreaterThan(0);
      // Record at index 2 is missing audio field
      expect(result.errors.some((e) => e.index === 2)).toBe(true);
    });

    it('should report missing audio field', async () => {
      const data = [{ other: 'value' }];
      const result = await batchValidateAudio(data, 'audio');
      expect(result.validIndices).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Missing audio field');
    });
  });
});
