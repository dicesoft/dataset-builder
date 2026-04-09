import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T092: Tests for useWebSocket hook — WebSocket connection, reconnect, event dispatch
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
    // Auto-fire open event on next tick
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

// Mock window for URL construction (the hook uses window.location)
vi.stubGlobal('window', {
  location: {
    protocol: 'http:',
    host: 'localhost:3000',
  },
});

// We need to import after mocks are set up
import { useWebSocket } from './useWebSocket';

// Minimal React hooks mock for testing the hook outside React
let cleanupFn: (() => void) | undefined;
const effectCallbacks: Function[] = [];
const stateValues: any[] = [];

vi.mock('react', () => ({
  useEffect: (cb: Function, _deps: any[]) => {
    effectCallbacks.push(cb);
  },
  useRef: (initial: any) => ({ current: initial }),
  useState: (initial: any) => {
    stateValues.push(initial);
    return [initial, vi.fn()];
  },
  useCallback: (cb: Function, _deps: any[]) => cb,
}));

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    effectCallbacks.length = 0;
    stateValues.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a ConnectionStatus value', () => {
    const status = useWebSocket();
    // Initial status is disconnected (the first useState call)
    expect(typeof status).toBe('string');
  });

  it('constructs correct WebSocket URL', () => {
    useWebSocket();
    // Run the useEffect callback to trigger connection
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws.url).toBe('ws://localhost:3000/api/v1/ws');
  });

  it('sends subscribe_all on connection open', async () => {
    useWebSocket();
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    // Let the open event fire
    await vi.advanceTimersByTimeAsync(10);

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws.sentMessages).toContain(JSON.stringify({ type: 'subscribe_all' }));
  });

  it('dispatches job:progress events to jobStore', async () => {
    useWebSocket();
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    await vi.advanceTimersByTimeAsync(10);

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    const progressData = {
      phase: 'downloading',
      current: 5,
      total: 10,
      counters: {},
      message: '',
      throughput: 1,
    };

    ws.fireEvent('message', {
      data: JSON.stringify({ type: 'job:progress', jobId: 'j1', data: progressData }),
    });

    expect(mockUpdateJobProgress).toHaveBeenCalledWith('j1', progressData);
  });

  it('dispatches job:status events to jobStore', async () => {
    useWebSocket();
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    await vi.advanceTimersByTimeAsync(10);

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.fireEvent('message', {
      data: JSON.stringify({ type: 'job:status', jobId: 'j1', data: { status: 'completed' } }),
    });

    expect(mockUpdateJobStatus).toHaveBeenCalledWith('j1', 'completed', { status: 'completed' });
  });

  it('dispatches job:error events to jobStore', async () => {
    useWebSocket();
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    await vi.advanceTimersByTimeAsync(10);

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.fireEvent('message', {
      data: JSON.stringify({
        type: 'job:error',
        jobId: 'j1',
        data: { code: 'SCRAPE_FAILED', message: 'Something broke', details: null },
      }),
    });

    expect(mockUpdateJobError).toHaveBeenCalledWith('j1', {
      code: 'SCRAPE_FAILED',
      message: 'Something broke',
      details: null,
    });
  });

  it('ignores malformed messages', async () => {
    useWebSocket();
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    await vi.advanceTimersByTimeAsync(10);

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    // Should not throw
    ws.fireEvent('message', { data: 'not json' });
    ws.fireEvent('message', { data: '{}' });

    expect(mockUpdateJobProgress).not.toHaveBeenCalled();
    expect(mockUpdateJobStatus).not.toHaveBeenCalled();
    expect(mockUpdateJobError).not.toHaveBeenCalled();
  });

  it('schedules reconnect on close with exponential backoff', async () => {
    // Mock Math.random to return 0 so jitter is deterministic (delay = base * 1.0)
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    useWebSocket();
    for (const cb of effectCallbacks) {
      cleanupFn = cb() as any;
    }

    await vi.advanceTimersByTimeAsync(10);

    const initialCount = MockWebSocket.instances.length;
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    // Simulate close
    ws.fireEvent('close', {});

    // After initial backoff (1000ms with 0 jitter), should reconnect
    await vi.advanceTimersByTimeAsync(1000);

    expect(MockWebSocket.instances.length).toBeGreaterThan(initialCount);

    randomSpy.mockRestore();
  });
});
