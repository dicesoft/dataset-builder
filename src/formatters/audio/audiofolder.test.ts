/**
 * Tests for AudioFolder formatter
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { vi } from 'vitest';
import { AudioFolderFormatter } from './audiofolder';

// Mock audio utils (copyAudio depends on real fs)
vi.mock('./utils', () => ({
  resolveAudioPath: vi.fn((p: string, base?: string) => {
    if (path.isAbsolute(p)) return p;
    return path.resolve(base || process.cwd(), p);
  }),
  copyAudio: vi.fn().mockResolvedValue(undefined),
  DEFAULT_AUDIO_EXTENSIONS: ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.wma', '.aac'],
}));

// Mock formatters/utils for ensureDir, writeData
vi.mock('../utils', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeData: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs/promises for direct writeFile calls in audiofolder.ts
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('AudioFolderFormatter', () => {
  let formatter: AudioFolderFormatter;

  beforeEach(() => {
    formatter = new AudioFolderFormatter();
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('should fail without classField option', () => {
      const data = [{ audio: 'file.wav', label: 'music' }];
      const result = formatter.validate(data, {});
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('--class-field');
    });

    it('should pass with valid audio and class fields', () => {
      const data = [
        { audio: 'file.wav', label: 'music' },
        { audio: 'file2.mp3', label: 'speech' },
      ];
      const result = formatter.validate(data, { classField: 'label' } as any);
      expect(result.valid).toBe(true);
      expect(result.stats?.valid).toBe(2);
    });

    it('should report errors for missing audio field', () => {
      const data = [{ label: 'music' }];
      const result = formatter.validate(data, { classField: 'label' } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'audio')).toBe(true);
    });

    it('should report errors for missing class field', () => {
      const data = [{ audio: 'file.wav' }];
      const result = formatter.validate(data, { classField: 'label' } as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'label')).toBe(true);
    });
  });

  describe('format', () => {
    it('should create class-based folder structure with metadata', async () => {
      const data = [
        { audio: 'speech_01.wav', label: 'greeting', extra: 'info1' },
        { audio: 'speech_02.mp3', label: 'statement', extra: 'info2' },
      ];

      const outputDir = path.join(os.tmpdir(), `af-test-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        classField: 'label',
        fieldMap: {},
        formatter: 'audiofolder',
      });

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('audiofolder');
      expect(result.metadata.counts.train).toBe(2);
      expect(result.metadata.counts.total).toBe(2);
    });

    it('should skip records with missing audio or class values', async () => {
      const data = [
        { audio: 'file.wav', label: 'music' },
        { audio: '', label: 'speech' },
        { audio: 'file2.wav', label: '' },
      ];

      const outputDir = path.join(os.tmpdir(), `af-skip-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        classField: 'label',
        fieldMap: {},
        formatter: 'audiofolder',
      });

      // Only first record should be processed
      expect(result.metadata.counts.train).toBe(1);
    });

    it('should respect custom audioExtensions', async () => {
      const data = [
        { audio: 'file.wav', label: 'music' },
        { audio: 'file.mp3', label: 'speech' },
      ];

      const outputDir = path.join(os.tmpdir(), `af-ext-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        classField: 'label',
        audioExtensions: ['.wav'], // Only allow .wav
        fieldMap: {},
        formatter: 'audiofolder',
      });

      // mp3 should be skipped
      expect(result.metadata.counts.train).toBe(1);
    });
  });
});
