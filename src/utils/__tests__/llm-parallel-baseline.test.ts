/**
 * Baseline tests for LLM parallel processing infrastructure.
 * Tests the concurrency queue, server config, adaptive batching, and model routing
 * without requiring a live Ollama server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConcurrencyQueue, createOllamaQueue } from '../concurrency';
import { calculateNeededConfig } from '../ollamaServer';
import { getModelForTask } from '../../generators/ollama';

// Mock config module for isolated testing
vi.mock('../../config', () => {
  const configValues: Record<string, unknown> = {
    ollamaConcurrency: 4,
    ollamaVisionConcurrency: 2,
    ollamaModel: 'llama3.2',
    ollamaVisionModel: 'llava',
    ollamaUrl: 'http://localhost:11434',
    ollamaMaxLoadedModels: undefined,
    ollamaClassifyModel: undefined,
    ollamaGenerateModel: undefined,
    translateModel: undefined,
    ollamaInstances: undefined,
  };

  return {
    getConfig: () => ({
      get: (key: string) => configValues[key],
      set: (key: string, value: unknown) => {
        configValues[key] = value;
      },
    }),
  };
});

describe('Parallel LLM Baseline', () => {
  describe('ConcurrencyQueue concurrency verification', () => {
    it('concurrency=1 runs sequentially', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 1 });
      const order: number[] = [];

      await queue.map([1, 2, 3], async (item) => {
        order.push(item);
        await new Promise((r) => setTimeout(r, 10));
        return item;
      });

      expect(order).toEqual([1, 2, 3]);
    });

    it('concurrency=4 runs up to 4 simultaneously', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 4 });
      let maxConcurrent = 0;
      let current = 0;

      await queue.map(
        Array.from({ length: 8 }, (_, i) => i),
        async (item) => {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          await new Promise((r) => setTimeout(r, 50));
          current--;
          return item;
        }
      );

      expect(maxConcurrent).toBe(4);
    });

    it('concurrency=8 runs up to 8 simultaneously', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 8 });
      let maxConcurrent = 0;
      let current = 0;

      await queue.map(
        Array.from({ length: 16 }, (_, i) => i),
        async (item) => {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          await new Promise((r) => setTimeout(r, 50));
          current--;
          return item;
        }
      );

      expect(maxConcurrent).toBe(8);
    });
  });

  describe('ConcurrencyQueue stats', () => {
    it('tracks completed and failed counts', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 2 });

      await queue.mapSettled([1, 2, 3, 4], async (item) => {
        if (item % 2 === 0) throw new Error('fail');
        return item;
      });

      expect(queue.stats.completed).toBe(2);
      expect(queue.stats.failed).toBe(2);
    });

    it('reports running count during execution', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 3 });
      let observedRunning = 0;

      await queue.map([1, 2, 3], async () => {
        observedRunning = queue.stats.running;
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(observedRunning).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ConcurrencyQueue priority', () => {
    it('high-priority tasks execute before low-priority ones', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 1 });
      const order: string[] = [];

      // Fill the queue: first task runs immediately, rest queue up
      const firstTask = queue.run(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push('first');
      }, 0);

      // Queue low-priority tasks
      const lowTask1 = queue.run(async () => {
        order.push('low-1');
      }, 10);
      const lowTask2 = queue.run(async () => {
        order.push('low-2');
      }, 10);

      // Queue high-priority task
      const highTask = queue.run(async () => {
        order.push('high');
      }, -1);

      await Promise.all([firstTask, lowTask1, lowTask2, highTask]);

      // High-priority should run before low-priority
      expect(order[0]).toBe('first');
      expect(order[1]).toBe('high');
    });
  });

  describe('ConcurrencyQueue drain', () => {
    it('drain waits for all work to complete', async () => {
      const queue = new ConcurrencyQueue({ concurrency: 2 });
      let completed = 0;

      // Start work without awaiting
      queue.run(async () => {
        await new Promise((r) => setTimeout(r, 30));
        completed++;
      });
      queue.run(async () => {
        await new Promise((r) => setTimeout(r, 30));
        completed++;
      });

      // Drain should wait
      await queue.drain();
      expect(completed).toBe(2);
    });
  });

  describe('calculateNeededConfig', () => {
    it('returns max of text and vision concurrency', () => {
      const config = calculateNeededConfig({
        ollamaConcurrency: 4,
        ollamaVisionConcurrency: 2,
      });
      expect(config.numParallel).toBe(4);
    });

    it('sets maxQueue to numParallel * 4', () => {
      const config = calculateNeededConfig({ ollamaConcurrency: 4 });
      expect(config.maxQueue).toBe(16);
    });

    it('defaults text concurrency to 4', () => {
      const config = calculateNeededConfig();
      expect(config.numParallel).toBeGreaterThanOrEqual(4);
    });
  });

  describe('createOllamaQueue', () => {
    it('creates queue with config concurrency for text', () => {
      const queue = createOllamaQueue('text');
      // Default ollamaConcurrency is 4 in our mock
      expect(queue).toBeDefined();
    });

    it('creates queue with config concurrency for vision', () => {
      const queue = createOllamaQueue('vision');
      expect(queue).toBeDefined();
    });

    it('respects concurrency override', async () => {
      const queue = createOllamaQueue('text', { concurrency: 2 });
      let maxConcurrent = 0;
      let current = 0;

      await queue.map([1, 2, 3, 4, 5], async (item) => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 30));
        current--;
        return item;
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('getModelForTask', () => {
    it('returns default model when no task-specific model set', () => {
      const model = getModelForTask('classify');
      expect(model).toBe('llama3.2');
    });

    it('returns vision model for vision task', () => {
      const model = getModelForTask('vision');
      expect(model).toBe('llava');
    });

    it('returns default model for generate task', () => {
      const model = getModelForTask('generate');
      expect(model).toBe('llama3.2');
    });
  });

  describe('throughput measurement', () => {
    it('higher concurrency processes more items per second', async () => {
      const measure = async (concurrency: number, items: number) => {
        const queue = new ConcurrencyQueue({ concurrency });
        const start = Date.now();

        await queue.map(
          Array.from({ length: items }, (_, i) => i),
          async () => {
            await new Promise((r) => setTimeout(r, 20));
          }
        );

        return Date.now() - start;
      };

      const time1 = await measure(1, 8);
      const time4 = await measure(4, 8);

      // With 4x concurrency, should be roughly 3-4x faster
      // Use a generous threshold since timing is imprecise
      expect(time4).toBeLessThan(time1 * 0.75);
    });
  });
});
