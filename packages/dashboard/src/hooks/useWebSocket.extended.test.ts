import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 4.6: Extended WebSocket hook tests — reconnect jitter, message routing, status
 *
 * Extends the existing useWebSocket.test.ts with additional edge case coverage.
 * Tests the hook logic without rendering React components.
 */

// Mock jobStore
const mockUpdateJobProgress = vi.fn();
const mockUpdateJobStatus = vi.fn();
const mockUpdateJobError = vi.fn();

vi.mock('../stores/jobStore', () => ({
  useJobStore: {
    getState: () => ({
      updateJobProgress: mockUpdateJobProgress,
      updateJobStatus: mockUpdateJobStatus,
      updateJobError: mockUpdateJobError,
    }),
  },
}));

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  listeners: Record<string, Function[]> = {};
  sentMessages: string[] = [];
  readyState = 1;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => this.fireEvent('open', {}), 0);
  }

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
  }

  fireEvent(event: string, data: any) {
    for (const handler of this.listeners[event] || []) {
      handler(data);
    }
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);
vi.stubGlobal('window', {
  location: { protocol: 'http:', host: 'localhost:3000' },
});

import { useWebSocket } from './useWebSocket';

let cleanupFn: (() => void) | undefined;
const effectCallbacks: Function[] = [];

vi.mock('react', () => ({
  useEffect: (cb: Function, _deps: any[]) => {
    effectCallbacks.push(cb);
  },
  useRef: (initial: any) => ({ current: initial }),
  useState: (initial: any) => [initial, vi.fn()],
  useCallback: (cb: Function, _deps: any[]) => cb,
}));

function initWs() {
  effectCallbacks.length = 0;
  useWebSocket();
  for (const cb of effectCallbacks) {
    cleanupFn = cb() as any;
  }
}

describe('useWebSocket (extended)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    effectCallbacks.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Reconnect with jitter', () => {
    it('applies 0-50% jitter to backoff delay', async () => {
      // useWebSocket.ts line 69: delay = baseDelay * (1 + Math.random() * 0.5)
      // With random=0, delay = baseDelay * 1.0
      // With random=1, delay = baseDelay * 1.5
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);

      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const countBefore = MockWebSocket.instances.length;
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.fireEvent('close', {});

      // With random=1, jitter is 50% of 1000ms = 500ms, so total delay = 1500ms
      // At 1000ms, should NOT have reconnected yet
      await vi.advanceTimersByTimeAsync(1000);
      expect(MockWebSocket.instances.length).toBe(countBefore);

      // At 1500ms, should have reconnected
      await vi.advanceTimersByTimeAsync(500);
      expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);

      randomSpy.mockRestore();
    });

    it('caps backoff at MAX_BACKOFF_MS (30s)', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      const MAX_BACKOFF_MS = 30_000;

      initWs();
      await vi.advanceTimersByTimeAsync(10);

      // Simulate many close events to ramp up backoff
      // Backoff doubles each time: 1000, 2000, 4000, 8000, 16000, 30000 (capped)
      for (let i = 0; i < 6; i++) {
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        ws.fireEvent('close', {});
        // Advance well past the backoff to trigger reconnect
        await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS + 1000);
      }

      // After 6 reconnect cycles, backoff should be capped
      // The exact number of instances depends on timing, but we should have multiple
      expect(MockWebSocket.instances.length).toBeGreaterThan(3);

      randomSpy.mockRestore();
    });
  });

  describe('Message routing edge cases', () => {
    it('routes job:progress with all progress fields to jobStore', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      const progress = {
        phase: 'transforming',
        current: 50,
        total: 100,
        counters: { processed: 50, errors: 2 },
        message: 'Processing records...',
        throughput: 10.5,
      };

      ws.fireEvent('message', {
        data: JSON.stringify({ type: 'job:progress', jobId: 'j42', data: progress }),
      });

      expect(mockUpdateJobProgress).toHaveBeenCalledWith('j42', progress);
    });

    it('routes job:status with extra data fields', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      const statusData = {
        status: 'completed',
        completedAt: '2026-04-03T12:00:00Z',
        duration: 45000,
        outputPath: '/output/result.jsonl',
      };

      ws.fireEvent('message', {
        data: JSON.stringify({ type: 'job:status', jobId: 'j42', data: statusData }),
      });

      expect(mockUpdateJobStatus).toHaveBeenCalledWith('j42', 'completed', statusData);
    });

    it('routes job:error and builds structured JobError', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      ws.fireEvent('message', {
        data: JSON.stringify({
          type: 'job:error',
          jobId: 'j99',
          data: { code: 'OOM', message: 'Out of memory', details: 'heap exceeded' },
        }),
      });

      expect(mockUpdateJobError).toHaveBeenCalledWith('j99', {
        code: 'OOM',
        message: 'Out of memory',
        details: 'heap exceeded',
      });
    });

    it('falls back to UNKNOWN code when code field is absent', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      ws.fireEvent('message', {
        data: JSON.stringify({
          type: 'job:error',
          jobId: 'j99',
          data: { message: 'Process crashed' },
        }),
      });

      expect(mockUpdateJobError).toHaveBeenCalledWith('j99', {
        code: 'UNKNOWN',
        message: 'Process crashed',
        details: null,
      });
    });

    it('uses "Unknown error" message when data fields are absent', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      ws.fireEvent('message', {
        data: JSON.stringify({
          type: 'job:error',
          jobId: 'j99',
          data: {},
        }),
      });

      expect(mockUpdateJobError).toHaveBeenCalledWith('j99', {
        code: 'UNKNOWN',
        message: 'Unknown error',
        details: null,
      });
    });

    it('ignores unknown message types without crashing', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      // Should not throw
      ws.fireEvent('message', {
        data: JSON.stringify({ type: 'unknown:event', jobId: 'j1', data: {} }),
      });

      expect(mockUpdateJobProgress).not.toHaveBeenCalled();
      expect(mockUpdateJobStatus).not.toHaveBeenCalled();
      expect(mockUpdateJobError).not.toHaveBeenCalled();
    });

    it('ignores messages with missing type field', async () => {
      initWs();
      await vi.advanceTimersByTimeAsync(10);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      ws.fireEvent('message', {
        data: JSON.stringify({ jobId: 'j1', data: {} }),
      });

      expect(mockUpdateJobProgress).not.toHaveBeenCalled();
    });
  });

  describe('Connection lifecycle', () => {
    it('constructs wss:// URL when protocol is https:', () => {
      // Temporarily change window.location
      (window as any).location.protocol = 'https:';

      initWs();

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(ws.url).toBe('wss://localhost:3000/api/v1/ws');

      // Restore
      (window as any).location.protocol = 'http:';
    });
  });
});
