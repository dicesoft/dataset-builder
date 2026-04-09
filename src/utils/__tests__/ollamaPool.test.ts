/**
 * Tests for OllamaPool multi-instance manager
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock dependencies — all mock factories must be self-contained (hoisted)
vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => {
      const values: Record<string, unknown> = {
        ollamaUrl: 'http://localhost:11434',
        ollamaConcurrency: 4,
        ollamaInstances: undefined,
      };
      return values[key];
    },
    set: () => {},
  }),
}));

vi.mock('../../generators/ollama', () => {
  class InlineMockOllamaClient {
    private url: string;
    constructor(url?: string) {
      this.url = url || 'http://localhost:11434';
    }
    async ping() {
      return this.url !== 'http://dead:11434';
    }
    async generate() {
      return { response: 'ok' };
    }
    getDefaultModel() {
      return 'llama3.2';
    }
  }

  return {
    OllamaClient: InlineMockOllamaClient,
    getOllama: () => new InlineMockOllamaClient(),
  };
});

// Import after mocks
import { OllamaPool } from '../ollamaPool';

describe('OllamaPool', () => {
  describe('single-instance fallback', () => {
    it('works without instance configs', async () => {
      const pool = new OllamaPool();
      await pool.initialize();

      const inst = await pool.acquire();
      expect(inst).toBeDefined();
      expect(inst.healthy).toBe(true);

      pool.release(inst);
      await pool.shutdown();
    });

    it('getStats returns single instance in fallback mode', async () => {
      const pool = new OllamaPool();
      await pool.initialize();

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(1);
      expect(stats.healthyInstances).toBe(1);

      await pool.shutdown();
    });
  });

  describe('multi-instance', () => {
    it('initializes multiple instances', async () => {
      const pool = new OllamaPool([
        { url: 'http://server1:11434' },
        { url: 'http://server2:11434' },
      ]);
      await pool.initialize();

      const stats = pool.getStats();
      expect(stats.totalInstances).toBe(2);

      await pool.shutdown();
    });

    it('uses least-connections for load balancing', async () => {
      const pool = new OllamaPool([
        { url: 'http://server1:11434' },
        { url: 'http://server2:11434' },
      ]);
      await pool.initialize();

      const inst1 = await pool.acquire();
      const inst2 = await pool.acquire();

      expect(inst1.url).not.toBe(inst2.url);

      pool.release(inst1);
      pool.release(inst2);
      await pool.shutdown();
    });

    it('filters by model availability', async () => {
      const pool = new OllamaPool([
        { url: 'http://server1:11434', models: ['llama3.2'] },
        { url: 'http://server2:11434', models: ['llava'] },
      ]);
      await pool.initialize();

      const inst = await pool.acquire('llava');
      expect(inst.url).toBe('http://server2:11434');

      pool.release(inst);
      await pool.shutdown();
    });

    it('respects weight in load balancing', async () => {
      const pool = new OllamaPool([
        { url: 'http://server1:11434', weight: 2 },
        { url: 'http://server2:11434', weight: 1 },
      ]);
      await pool.initialize();

      const inst = await pool.acquire();
      expect(inst.url).toBe('http://server1:11434');

      pool.release(inst);
      await pool.shutdown();
    });

    it('handles failover when instance is unhealthy', async () => {
      const pool = new OllamaPool([{ url: 'http://dead:11434' }, { url: 'http://server2:11434' }]);
      await pool.initialize();

      const stats = pool.getStats();
      expect(stats.healthyInstances).toBe(1);

      const inst = await pool.acquire();
      expect(inst.url).toBe('http://server2:11434');

      pool.release(inst);
      await pool.shutdown();
    });

    it('throws when no healthy instances available', async () => {
      const pool = new OllamaPool([{ url: 'http://dead:11434' }]);
      await pool.initialize();

      await expect(pool.acquire()).rejects.toThrow('No healthy Ollama instances available');

      await pool.shutdown();
    });

    it('release decrements active connections', async () => {
      const pool = new OllamaPool([{ url: 'http://server1:11434' }]);
      await pool.initialize();

      const inst = await pool.acquire();
      expect(inst.activeConnections).toBe(1);

      pool.release(inst);
      expect(inst.activeConnections).toBe(0);

      await pool.shutdown();
    });
  });

  describe('shutdown', () => {
    it('cleans up and resets state', async () => {
      const pool = new OllamaPool([{ url: 'http://server1:11434' }]);
      await pool.initialize();

      const statsBefore = pool.getStats();
      expect(statsBefore.totalInstances).toBe(1);

      await pool.shutdown();

      // After shutdown, instances are cleared
      const statsAfter = pool.getStats();
      expect(statsAfter.totalInstances).toBe(0);
    });
  });
});
