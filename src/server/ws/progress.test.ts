import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * T089: Unit tests for WebSocket progress multiplexer
 *
 * Tests the plugin's subscribe/unsubscribe/broadcast logic by registering
 * the plugin with a mock Fastify instance and simulating WebSocket clients.
 */

// ---------------------------------------------------------------------------
// Shared mock job manager
// ---------------------------------------------------------------------------

const mockJobManager = new EventEmitter();

vi.mock('../jobs/manager', () => ({
  getJobManager: () => mockJobManager,
}));

vi.mock('../jobs/types', () => ({
  JobProgress: {},
  JobError: {},
  JobRecord: {},
}));

// ---------------------------------------------------------------------------
// Mock Fastify WebSocket
// ---------------------------------------------------------------------------

vi.mock('@fastify/websocket', () => ({
  WebSocket: { OPEN: 1 },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  _handlers: Map<string, Function[]>;
  on: (event: string, handler: Function) => void;
  triggerMessage: (data: unknown) => void;
  triggerClose: () => void;
  triggerError: (err: Error) => void;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, Function[]>();
  return {
    readyState: 1,
    send: vi.fn(),
    _handlers: handlers,
    on(event: string, handler: Function) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    triggerMessage(data: unknown) {
      for (const h of handlers.get('message') ?? []) h(JSON.stringify(data));
    },
    triggerClose() {
      for (const h of handlers.get('close') ?? []) h();
    },
    triggerError(err: Error) {
      for (const h of handlers.get('error') ?? []) h(err);
    },
  };
}

// ---------------------------------------------------------------------------
// Register the plugin once and collect the WS handler
// ---------------------------------------------------------------------------

type WsHandler = (socket: MockSocket, request: unknown) => void;
let wsHandler: WsHandler;

// Note: we do NOT remove listeners from mockJobManager in beforeEach,
// because the plugin registers its listeners once during registration.
// Instead, we disconnect clients between tests via triggerClose.

// Import and register the plugin
import wsProgressPlugin from './progress';

// Use a global mock Fastify to capture the route handler
const registeredHandlers: WsHandler[] = [];
const mockFastify = {
  get: vi.fn((_path: string, _opts: unknown, handler: WsHandler) => {
    registeredHandlers.push(handler);
  }),
  log: { info: vi.fn(), error: vi.fn() },
};

// Register the plugin synchronously via the callback pattern
(wsProgressPlugin as any)(mockFastify, {}, () => {});
wsHandler = registeredHandlers[0];

function connectClient(socket?: MockSocket): MockSocket {
  const s = socket ?? createMockSocket();
  wsHandler(s, {});
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocket progress multiplexer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe to specific job ID', () => {
    it('receives events only for the subscribed job', () => {
      const socket = connectClient();

      // Subscribe to job-1
      socket.triggerMessage({ type: 'subscribe', jobId: 'job-1' });

      // Should get subscription confirmation
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"subscribed"'));
      socket.send.mockClear();

      // Emit progress for job-1
      mockJobManager.emit('job:progress', 'job-1', {
        phase: 'Testing',
        current: 1,
        total: 5,
      });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg.type).toBe('job:progress');
      expect(msg.jobId).toBe('job-1');

      socket.send.mockClear();

      // Emit progress for job-2 (not subscribed)
      mockJobManager.emit('job:progress', 'job-2', {
        phase: 'Other',
        current: 1,
        total: 5,
      });

      // Should NOT receive it
      expect(socket.send).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('stops receiving events after unsubscribe', () => {
      const socket = connectClient();

      socket.triggerMessage({ type: 'subscribe', jobId: 'job-1' });
      socket.send.mockClear();

      socket.triggerMessage({ type: 'unsubscribe', jobId: 'job-1' });

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"unsubscribed"'));
      socket.send.mockClear();

      mockJobManager.emit('job:progress', 'job-1', {
        phase: 'X',
        current: 1,
        total: 1,
      });

      expect(socket.send).not.toHaveBeenCalled();
    });
  });

  describe('subscribe_all', () => {
    it('receives all job events', () => {
      const socket = connectClient();

      socket.triggerMessage({ type: 'subscribe_all' });

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"subscribed_all"'));
      socket.send.mockClear();

      mockJobManager.emit('job:progress', 'job-1', { phase: 'A', current: 1, total: 5 });
      mockJobManager.emit('job:progress', 'job-2', { phase: 'B', current: 2, total: 10 });

      expect(socket.send).toHaveBeenCalledTimes(2);

      const msg1 = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg1.jobId).toBe('job-1');

      const msg2 = JSON.parse(socket.send.mock.calls[1][0]);
      expect(msg2.jobId).toBe('job-2');
    });
  });

  describe('multiple clients', () => {
    it('get independent subscriptions', () => {
      const socket1 = connectClient();
      const socket2 = connectClient();

      socket1.triggerMessage({ type: 'subscribe', jobId: 'job-1' });
      socket2.triggerMessage({ type: 'subscribe', jobId: 'job-2' });

      socket1.send.mockClear();
      socket2.send.mockClear();

      // Emit for job-1
      mockJobManager.emit('job:progress', 'job-1', { phase: 'A', current: 1, total: 1 });

      expect(socket1.send).toHaveBeenCalledTimes(1);
      expect(socket2.send).not.toHaveBeenCalled();

      socket1.send.mockClear();

      // Emit for job-2
      mockJobManager.emit('job:progress', 'job-2', { phase: 'B', current: 1, total: 1 });

      expect(socket1.send).not.toHaveBeenCalled();
      expect(socket2.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('event forwarding', () => {
    it('forwards job:status events', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      mockJobManager.emit('job:status', 'job-1', {
        status: 'completed',
        completedAt: '2026-01-01T00:00:00Z',
        duration: 5000,
        outputPath: '/output/test',
      });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg.type).toBe('job:status');
      expect(msg.data.status).toBe('completed');
    });

    it('includes result and outputPath in job:status broadcast for completed jobs', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      mockJobManager.emit('job:status', 'job-1', {
        status: 'completed',
        completedAt: '2026-01-01T00:00:00Z',
        duration: 5000,
        outputPath: '/output/scrape-results.jsonl',
        result: { records: 42, outputFile: '/output/scrape-results.jsonl' },
      });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg.data.status).toBe('completed');
      expect(msg.data.outputPath).toBe('/output/scrape-results.jsonl');
      expect(msg.data.result).toEqual({ records: 42, outputFile: '/output/scrape-results.jsonl' });
    });

    it('does NOT include result in job:status broadcast for non-completed status', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      mockJobManager.emit('job:status', 'job-1', {
        status: 'running',
        completedAt: null,
        duration: null,
        outputPath: null,
        result: null,
      });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg.data.status).toBe('running');
      expect(msg.data).not.toHaveProperty('result');
    });

    it('forwards job:error events', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      mockJobManager.emit('job:error', 'job-1', {
        code: 'TEST_ERROR',
        message: 'Something failed',
        details: null,
      });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg.type).toBe('job:error');
      expect(msg.data.code).toBe('TEST_ERROR');
    });
    it('forwards job:log events', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      mockJobManager.emit('job:log', 'job-1', 'Fetching page 1 of 5');

      expect(socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(socket.send.mock.calls[0][0]);
      expect(msg.type).toBe('job:log');
      expect(msg.jobId).toBe('job-1');
      expect(msg.data).toEqual({ line: 'Fetching page 1 of 5' });
    });
  });

  describe('error handling', () => {
    it('sends error for invalid JSON messages', () => {
      const socket = connectClient();
      socket.send.mockClear();

      // Send raw invalid JSON through the message handler
      for (const h of socket._handlers.get('message') ?? []) {
        h('not valid json{{{');
      }

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
    });

    it('sends error for unknown message type', () => {
      const socket = connectClient();
      socket.send.mockClear();

      socket.triggerMessage({ type: 'unknown_type' });

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('Unknown message type'));
    });
  });

  describe('disconnect', () => {
    it('cleans up on close', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      socket.triggerClose();

      mockJobManager.emit('job:progress', 'job-1', { phase: 'Test', current: 1, total: 1 });
      expect(socket.send).not.toHaveBeenCalled();
    });

    it('cleans up on error', () => {
      const socket = connectClient();
      socket.triggerMessage({ type: 'subscribe_all' });
      socket.send.mockClear();

      socket.triggerError(new Error('connection reset'));

      mockJobManager.emit('job:progress', 'job-1', { phase: 'Test', current: 1, total: 1 });
      expect(socket.send).not.toHaveBeenCalled();
    });
  });
});
