import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateNeededConfig } from './ollamaServer';

vi.mock('../config', () => ({
  getConfig: () => ({
    get: (key: string) => {
      const defaults: Record<string, unknown> = {
        ollamaConcurrency: 1,
        ollamaVisionConcurrency: 1,
        ollamaUrl: 'http://localhost:11434',
      };
      return defaults[key];
    },
  }),
}));

describe('ollamaServer', () => {
  describe('calculateNeededConfig', () => {
    it('returns numParallel=1 with default config', () => {
      const config = calculateNeededConfig();
      expect(config.numParallel).toBe(1);
    });

    it('uses max of text and vision concurrency', () => {
      const config = calculateNeededConfig({
        ollamaConcurrency: 3,
        ollamaVisionConcurrency: 5,
      });
      expect(config.numParallel).toBe(5);
    });

    it('sets maxQueue proportional to numParallel', () => {
      const config = calculateNeededConfig({
        ollamaConcurrency: 4,
        ollamaVisionConcurrency: 2,
      });
      expect(config.numParallel).toBe(4);
      expect(config.maxQueue).toBe(16);
    });

    it('handles text-only concurrency', () => {
      const config = calculateNeededConfig({
        ollamaConcurrency: 6,
      });
      expect(config.numParallel).toBe(6);
    });

    it('handles vision-only concurrency', () => {
      const config = calculateNeededConfig({
        ollamaVisionConcurrency: 8,
      });
      expect(config.numParallel).toBe(8);
    });
  });
});
