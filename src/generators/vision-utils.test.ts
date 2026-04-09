/**
 * Unit tests for vision utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  analyzeImage,
  classifyImage,
  captionImage,
  type ClassificationResult,
} from './vision-utils';
import ollama from 'ollama';
import { getConfig } from '../config';

// Mock ollama package
vi.mock('ollama', () => ({
  default: {
    chat: vi.fn(),
  },
}));

// Mock config
vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    get: vi.fn((key: string) => {
      if (key === 'ollamaModel') return 'llama3';
      if (key === 'ollamaVisionModel') return 'llava';
      return undefined;
    }),
  })),
}));

describe('vision-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeImage', () => {
    it('should analyze image with custom prompt', async () => {
      const mockResponse = {
        message: {
          content: 'This image shows a red sports car.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await analyzeImage('/path/to/image.jpg', 'What is in this image?');

      expect(result).toBe('This image shows a red sports car.');
      expect(ollama.chat).toHaveBeenCalledWith({
        model: 'llava',
        messages: [
          {
            role: 'user',
            content: 'What is in this image?',
            images: ['/path/to/image.jpg'],
          },
        ],
        options: {
          temperature: 0.7,
        },
      });
    });

    it('should use custom model when provided', async () => {
      const mockResponse = {
        message: {
          content: 'Analysis complete.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      await analyzeImage('/path/to/image.jpg', 'Analyze this', 'custom-vision-model');

      expect(ollama.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-vision-model',
        })
      );
    });

    it('should throw error on failure', async () => {
      vi.mocked(ollama.chat).mockRejectedValue(new Error('Connection failed'));

      await expect(analyzeImage('/path/to/image.jpg', 'What is this?')).rejects.toThrow(
        'Image analysis failed: Connection failed'
      );
    });

    it('should filter thinking tokens from response', async () => {
      const mockResponse = {
        message: {
          content: '<thinking>Let me analyze...</thinking> This is a cat.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await analyzeImage('/path/to/image.jpg', 'What animal?');

      expect(result).toBe('This is a cat.');
    });
  });

  describe('classifyImage', () => {
    it('should classify image and return structured result', async () => {
      const mockResponse = {
        message: {
          content: JSON.stringify({
            label: 'sports car',
            relevance: 0.95,
            caption: 'A red Ferrari sports car parked on a street.',
          }),
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await classifyImage('/path/to/car.jpg', 'car');

      expect(result).toEqual<ClassificationResult>({
        label: 'sports car',
        relevance: 0.95,
        caption: 'A red Ferrari sports car parked on a street.',
      });
      expect(ollama.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'llava',
          options: {
            temperature: 0.3,
          },
          format: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              relevance: { type: 'number' },
              caption: { type: 'string' },
            },
            required: ['label', 'relevance', 'caption'],
          },
        })
      );
    });

    it('should clamp relevance to valid range', async () => {
      const mockResponse = {
        message: {
          content: JSON.stringify({
            label: 'test',
            relevance: 1.5, // Above 1.0
            caption: 'Test caption',
          }),
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await classifyImage('/path/to/image.jpg', 'test');

      expect(result.relevance).toBe(1.0);
    });

    it('should handle negative relevance', async () => {
      const mockResponse = {
        message: {
          content: JSON.stringify({
            label: 'test',
            relevance: -0.5, // Below 0.0
            caption: 'Test caption',
          }),
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await classifyImage('/path/to/image.jpg', 'test');

      expect(result.relevance).toBe(0);
    });

    it('should return fallback result on invalid JSON', async () => {
      const mockResponse = {
        message: {
          content: 'This is not valid JSON',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await classifyImage('/path/to/image.jpg', 'test');

      expect(result.label).toBe('unknown');
      expect(result.relevance).toBe(0);
      expect(result.caption).toBe('This is not valid JSON');
    });

    it('should throw error on API failure', async () => {
      vi.mocked(ollama.chat).mockRejectedValue(new Error('Model not found'));

      await expect(classifyImage('/path/to/image.jpg', 'car')).rejects.toThrow(
        'Image classification failed: Model not found'
      );
    });
  });

  describe('captionImage', () => {
    it('should generate one-sentence caption', async () => {
      const mockResponse = {
        message: {
          content: 'A beautiful sunset over the ocean with orange and pink clouds.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await captionImage('/path/to/sunset.jpg');

      expect(result).toBe('A beautiful sunset over the ocean with orange and pink clouds.');
    });

    it('should extract first sentence if multiple provided', async () => {
      const mockResponse = {
        message: {
          content: 'First sentence. Second sentence. Third one here.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await captionImage('/path/to/image.jpg');

      expect(result).toBe('First sentence.');
    });

    it('should handle exclamation marks as sentence delimiters', async () => {
      const mockResponse = {
        message: {
          content: 'What a beautiful view! It is amazing.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await captionImage('/path/to/image.jpg');

      expect(result).toBe('What a beautiful view!');
    });

    it('should handle question marks as sentence delimiters', async () => {
      const mockResponse = {
        message: {
          content: 'Is this a cat? It looks like one.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await captionImage('/path/to/image.jpg');

      expect(result).toBe('Is this a cat?');
    });

    it('should use custom model when provided', async () => {
      const mockResponse = {
        message: {
          content: 'A caption.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      await captionImage('/path/to/image.jpg', 'custom-model');

      expect(ollama.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model',
        })
      );
    });

    it('should throw error on failure', async () => {
      vi.mocked(ollama.chat).mockRejectedValue(new Error('Timeout'));

      await expect(captionImage('/path/to/image.jpg')).rejects.toThrow(
        'Image captioning failed: Timeout'
      );
    });

    it('should filter thinking tokens', async () => {
      const mockResponse = {
        message: {
          content: '<thinking>Analyzing...</thinking> A cat sitting on a mat.',
        },
      };
      vi.mocked(ollama.chat).mockResolvedValue(mockResponse);

      const result = await captionImage('/path/to/image.jpg');

      expect(result).toBe('A cat sitting on a mat.');
    });
  });
});
