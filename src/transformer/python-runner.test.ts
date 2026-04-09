import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPythonScript, findPython, checkPythonPackage } from './python-runner';

// Mock child_process
vi.mock('child_process', () => {
  const EventEmitter = require('events');

  function createMockProc(opts: {
    stdout?: string;
    stderr?: string;
    code?: number;
    error?: Error;
  }) {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    setTimeout(() => {
      if (opts.error) {
        proc.emit('error', opts.error);
        return;
      }
      if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
      proc.emit('close', opts.code ?? 0);
    }, 10);

    return proc;
  }

  let spawnHandler: (cmd: string, args: string[], opts: unknown) => unknown;

  return {
    spawn: vi.fn((...args: unknown[]) => {
      if (spawnHandler) return spawnHandler(args[0] as string, args[1] as string[], args[2]);
      return createMockProc({ stdout: '', code: 0 });
    }),
    __setSpawnHandler: (handler: typeof spawnHandler) => {
      spawnHandler = handler;
    },
    __createMockProc: createMockProc,
  };
});

const { __setSpawnHandler, __createMockProc } = (await import('child_process')) as unknown as {
  __setSpawnHandler: (handler: (cmd: string, args: string[], opts: unknown) => unknown) => void;
  __createMockProc: (opts: {
    stdout?: string;
    stderr?: string;
    code?: number;
    error?: Error;
  }) => unknown;
};

describe('python-runner', () => {
  beforeEach(() => {
    __setSpawnHandler(
      null as unknown as typeof __setSpawnHandler extends (arg: infer T) => void ? T : never
    );
  });

  describe('runPythonScript', () => {
    it('should parse JSON output on success', async () => {
      const jsonOutput = { objects: [{ label: 'cat', bbox: [10, 20, 30, 40] }] };

      __setSpawnHandler((cmd, args) => {
        if (args[0]?.includes('.py')) {
          return __createMockProc({ stdout: JSON.stringify(jsonOutput), code: 0 });
        }
        // findPython check
        return __createMockProc({ stdout: 'Python 3.11.0', code: 0 });
      });

      const result = await runPythonScript('test.py', ['--image', 'test.jpg']);
      expect(result.success).toBe(true);
      expect(result.jsonOutput).toEqual(jsonOutput);
    });

    it('should handle script failure', async () => {
      __setSpawnHandler((cmd, args) => {
        if (args[0]?.includes('.py')) {
          return __createMockProc({ stderr: 'ModuleNotFoundError', code: 1 });
        }
        return __createMockProc({ stdout: 'Python 3.11.0', code: 0 });
      });

      const result = await runPythonScript('test.py', []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ModuleNotFoundError');
    });

    it('should handle spawn error', async () => {
      __setSpawnHandler((cmd, args) => {
        if (args[0]?.includes('.py')) {
          return __createMockProc({ error: new Error('ENOENT') });
        }
        return __createMockProc({ stdout: 'Python 3.11.0', code: 0 });
      });

      const result = await runPythonScript('test.py', []);
      expect(result.success).toBe(false);
      expect(result.error).toBe('ENOENT');
    });

    it('should return null jsonOutput for non-JSON stdout', async () => {
      __setSpawnHandler((cmd, args) => {
        if (args[0]?.includes('.py')) {
          return __createMockProc({ stdout: 'not json at all', code: 0 });
        }
        return __createMockProc({ stdout: 'Python 3.11.0', code: 0 });
      });

      const result = await runPythonScript('test.py', []);
      expect(result.success).toBe(true);
      expect(result.jsonOutput).toBeNull();
      expect(result.output).toBe('not json at all');
    });
  });
});
