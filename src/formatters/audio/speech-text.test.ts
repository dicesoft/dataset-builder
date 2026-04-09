/**
 * Tests for SpeechText formatter
 */

import path from 'path';
import os from 'os';
import { vi } from 'vitest';
import { SpeechTextFormatter } from './speech-text';

// Mock audio utils
vi.mock('./utils', () => ({
  resolveAudioPath: vi.fn((p: string, base?: string) => {
    if (path.isAbsolute(p)) return p;
    return path.resolve(base || process.cwd(), p);
  }),
  validateAudio: vi.fn().mockResolvedValue({ valid: true }),
  copyAudio: vi.fn().mockResolvedValue(undefined),
  getAudioMetadata: vi.fn().mockResolvedValue({ duration: 5.0, sampleRate: 44100 }),
  DEFAULT_AUDIO_EXTENSIONS: ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.wma', '.aac'],
}));

// Mock formatters/utils
vi.mock('../utils', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeData: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs/promises for writeFile
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

import { getAudioMetadata, validateAudio } from './utils';

describe('SpeechTextFormatter', () => {
  let formatter: SpeechTextFormatter;

  beforeEach(() => {
    formatter = new SpeechTextFormatter();
    vi.clearAllMocks();
  });

  describe('validate', () => {
    it('should pass with valid audio and text fields', () => {
      const data = [
        { audio: 'speech.wav', text: 'Hello world' },
        { audio: 'speech2.mp3', text: 'Goodbye' },
      ];
      const result = formatter.validate(data);
      expect(result.valid).toBe(true);
      expect(result.stats?.valid).toBe(2);
    });

    it('should fail when audio field is missing', () => {
      const data = [{ text: 'Hello world' }];
      const result = formatter.validate(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'audio')).toBe(true);
    });

    it('should fail when text field is missing', () => {
      const data = [{ audio: 'speech.wav' }];
      const result = formatter.validate(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'text')).toBe(true);
    });

    it('should validate with custom textField option', () => {
      const data = [{ audio: 'speech.wav', transcript: 'Hello' }];
      const result = formatter.validate(data, { textField: 'transcript' });
      expect(result.valid).toBe(true);
    });

    it('should fail when custom textField is missing', () => {
      const data = [{ audio: 'speech.wav', text: 'Hello' }];
      const result = formatter.validate(data, { textField: 'transcript' });
      expect(result.valid).toBe(false);
    });
  });

  describe('format', () => {
    it('should create speech-text records', async () => {
      const data = [
        { audio: 'speech_01.wav', text: 'Hello' },
        { audio: 'speech_02.mp3', text: 'Goodbye' },
      ];

      const outputDir = path.join(os.tmpdir(), `st-test-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        fieldMap: {},
        formatter: 'speech-text',
      });

      expect(result.outputDir).toBe(outputDir);
      expect(result.metadata.formatter).toBe('speech-text');
      expect(result.metadata.counts.train).toBe(2);
      expect(result.metadata.counts.total).toBe(2);
    });

    it('should use durationField from existing data', async () => {
      const data = [{ audio: 'speech.wav', text: 'Hello', dur: 3.5 }];

      const outputDir = path.join(os.tmpdir(), `st-dur-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        fieldMap: {},
        formatter: 'speech-text',
        durationField: 'dur',
      });

      expect(result.metadata.counts.train).toBe(1);
    });

    it('should extract duration via ffprobe when extractDuration is true', async () => {
      const data = [{ audio: 'speech.wav', text: 'Hello' }];

      const outputDir = path.join(os.tmpdir(), `st-extract-${Date.now()}`);
      await formatter.format(data, {
        outputDir,
        fieldMap: {},
        formatter: 'speech-text',
        extractDuration: true,
      });

      expect(getAudioMetadata).toHaveBeenCalled();
    });

    it('should skip records with empty text', async () => {
      const data = [
        { audio: 'speech.wav', text: 'Hello' },
        { audio: 'speech2.wav', text: '' },
        { audio: 'speech3.wav', text: null },
      ];

      const outputDir = path.join(os.tmpdir(), `st-skip-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        fieldMap: {},
        formatter: 'speech-text',
      });

      expect(result.metadata.counts.train).toBe(1);
    });

    it('should skip records with invalid audio', async () => {
      vi.mocked(validateAudio)
        .mockResolvedValueOnce({ valid: true })
        .mockResolvedValueOnce({ valid: false, error: 'bad ext' });

      const data = [
        { audio: 'speech.wav', text: 'Hello' },
        { audio: 'speech.txt', text: 'Goodbye' },
      ];

      const outputDir = path.join(os.tmpdir(), `st-invalid-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        fieldMap: {},
        formatter: 'speech-text',
      });

      expect(result.metadata.counts.train).toBe(1);
    });

    it('should use custom textField in format', async () => {
      const data = [{ audio: 'speech.wav', transcript: 'Hello' }];

      const outputDir = path.join(os.tmpdir(), `st-custom-${Date.now()}`);
      const result = await formatter.format(data, {
        outputDir,
        fieldMap: {},
        formatter: 'speech-text',
        textField: 'transcript',
      });

      expect(result.metadata.counts.train).toBe(1);
    });
  });
});
