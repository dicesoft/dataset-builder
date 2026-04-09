import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T088: Unit tests for health checker
 */

// ---------------------------------------------------------------------------
// Mock child_process.execFile
// ---------------------------------------------------------------------------

const mockExecFile = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// ---------------------------------------------------------------------------
// Mock http/https for Ollama check
// ---------------------------------------------------------------------------

const mockHttpGet = vi.fn();

vi.mock('http', () => ({
  default: { get: (...args: unknown[]) => mockHttpGet(...args) },
  get: (...args: unknown[]) => mockHttpGet(...args),
}));

vi.mock('https', () => ({
  default: { get: vi.fn() },
  get: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------

vi.mock('../../config', () => ({
  getConfig: () => ({
    get: (key: string) => {
      if (key === 'ollamaUrl') return 'http://localhost:11434';
      return '';
    },
  }),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  checkAllDependencies,
  checkDependenciesForCommand,
  clearCache,
  HealthChecker,
} from './checker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up mockExecFile to resolve for a given command
 */
function mockExecSuccess(cmd: string, stdout: string, stderr = '') {
  mockExecFile.mockImplementation(
    (command: string, _args: string[], _opts: unknown, cb: Function) => {
      if (command === cmd) {
        cb(null, stdout, stderr);
      } else {
        cb(new Error(`${command}: not found`), '', '');
      }
    }
  );
}

/**
 * Set up mockExecFile to resolve for multiple commands
 */
function mockExecMultiple(commands: Record<string, { stdout: string; stderr?: string }>) {
  mockExecFile.mockImplementation(
    (command: string, _args: string[], _opts: unknown, cb: Function) => {
      const entry = commands[command];
      if (entry) {
        cb(null, entry.stdout, entry.stderr ?? '');
      } else {
        cb(new Error(`${command}: not found`), '', '');
      }
    }
  );
}

/**
 * Set up mockHttpGet to simulate Ollama response
 */
function mockOllamaAvailable() {
  mockHttpGet.mockImplementation((_url: string, _opts: unknown, cb: Function) => {
    const res = {
      statusCode: 200,
      on: (event: string, handler: Function) => {
        if (event === 'data') handler(Buffer.from('{"models":[]}'));
        if (event === 'end') handler();
        return res;
      },
    };
    cb(res);
    return { on: vi.fn(), destroy: vi.fn() };
  });
}

function mockOllamaUnavailable() {
  mockHttpGet.mockImplementation((_url: string, _opts: unknown, _cb: Function) => {
    const req = {
      on: (event: string, handler: Function) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('Connection refused')), 0);
        }
        return req;
      },
      destroy: vi.fn(),
    };
    return req;
  });
}

describe('health checker', () => {
  beforeEach(() => {
    clearCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearCache();
  });

  // -----------------------------------------------------------------------
  // Individual dependency checks
  // -----------------------------------------------------------------------

  describe('checkAllDependencies', () => {
    it('returns all 5 dependencies', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11.5' },
        scrapy: { stdout: 'Scrapy 2.11.0' },
        ffmpeg: { stdout: 'ffmpeg version 6.1.1' },
        'yt-dlp': { stdout: '2024.12.01' },
      });

      const results = await checkAllDependencies(true);
      expect(results).toHaveLength(5);

      const names = results.map((r) => r.name);
      expect(names).toContain('ollama');
      expect(names).toContain('python');
      expect(names).toContain('scrapy');
      expect(names).toContain('ffmpeg');
      expect(names).toContain('yt-dlp');
    });

    it('returns available=true and version for available tools', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11.5' },
        scrapy: { stdout: 'Scrapy 2.11.0' },
        ffmpeg: { stdout: 'ffmpeg version 6.1.1' },
        'yt-dlp': { stdout: '2024.12.01' },
      });

      const results = await checkAllDependencies(true);

      const python = results.find((r) => r.name === 'python')!;
      expect(python.available).toBe(true);
      expect(python.version).toBe('3.11.5');
      expect(python.error).toBeNull();

      const scrapy = results.find((r) => r.name === 'scrapy')!;
      expect(scrapy.available).toBe(true);
      expect(scrapy.version).toBe('2.11.0');

      const ffmpeg = results.find((r) => r.name === 'ffmpeg')!;
      expect(ffmpeg.available).toBe(true);
      expect(ffmpeg.version).toBe('6.1.1');

      const ytdlp = results.find((r) => r.name === 'yt-dlp')!;
      expect(ytdlp.available).toBe(true);
      expect(ytdlp.version).toBe('2024.12.01');
    });

    it('returns available=false and error for unavailable tools', async () => {
      mockOllamaUnavailable();
      mockExecFile.mockImplementation(
        (command: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error(`${command}: not found in PATH`), '', '');
        }
      );

      const results = await checkAllDependencies(true);

      for (const dep of results) {
        expect(dep.available).toBe(false);
        expect(dep.error).toBeTruthy();
      }
    });

    it('includes requiredBy for each dependency', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      const results = await checkAllDependencies(true);

      const ollama = results.find((r) => r.name === 'ollama')!;
      expect(ollama.requiredBy).toContain('generate');
      expect(ollama.requiredBy).toContain('transform');

      const python = results.find((r) => r.name === 'python')!;
      expect(python.requiredBy).toContain('scrape');

      const ffmpeg = results.find((r) => r.name === 'ffmpeg')!;
      expect(ffmpeg.requiredBy).toContain('compress');
    });
  });

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------

  describe('caching', () => {
    it('caches results for 1 minute', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      const first = await checkAllDependencies(true);
      const second = await checkAllDependencies(); // should use cache

      // Same reference if cached
      expect(second).toBe(first);

      // execFile should only be called for the first set
      const execCallCount = mockExecFile.mock.calls.length;

      await checkAllDependencies(); // still cached
      expect(mockExecFile.mock.calls.length).toBe(execCallCount);
    });

    it('force=true bypasses cache', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      await checkAllDependencies(true);
      const execCallCountAfterFirst = mockExecFile.mock.calls.length;

      await checkAllDependencies(true); // force refresh
      expect(mockExecFile.mock.calls.length).toBeGreaterThan(execCallCountAfterFirst);
    });

    it('clearCache causes re-check on next call', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      await checkAllDependencies(true);
      const callCount = mockExecFile.mock.calls.length;

      clearCache();
      await checkAllDependencies();

      expect(mockExecFile.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  // -----------------------------------------------------------------------
  // checkDependenciesForCommand
  // -----------------------------------------------------------------------

  describe('checkDependenciesForCommand', () => {
    it('returns ok=true when all required deps are available', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      clearCache();
      const result = await checkDependenciesForCommand('scrape');
      expect(result.ok).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('returns ok=false with missing deps when required dep is unavailable', async () => {
      mockOllamaUnavailable();
      mockExecFile.mockImplementation(
        (command: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(new Error(`${command}: not found`), '', '');
        }
      );

      clearCache();
      const result = await checkDependenciesForCommand('generate');
      expect(result.ok).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
      expect(result.missing.some((d) => d.name === 'ollama')).toBe(true);
    });

    it('returns ok=true for commands with no dependencies', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      clearCache();
      const result = await checkDependenciesForCommand('export');
      expect(result.ok).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // HealthChecker class
  // -----------------------------------------------------------------------

  describe('HealthChecker class', () => {
    it('getReport returns a health report', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      clearCache();
      const checker = new HealthChecker();
      const report = await checker.getReport();

      expect(report).toHaveProperty('healthy');
      expect(report).toHaveProperty('dependencies');
      expect(report).toHaveProperty('checkedAt');
      expect(report.dependencies).toHaveLength(5);
    });

    it('refresh bypasses cache', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      const checker = new HealthChecker();
      await checker.getReport();
      const callCountAfterFirst = mockExecFile.mock.calls.length;

      await checker.refresh();
      expect(mockExecFile.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });

    it('reports healthy=true when all deps available', async () => {
      mockOllamaAvailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      clearCache();
      const checker = new HealthChecker();
      const report = await checker.getReport();
      expect(report.healthy).toBe(true);
    });

    it('reports healthy=false when any dep is unavailable', async () => {
      mockOllamaUnavailable();
      mockExecMultiple({
        python: { stdout: 'Python 3.11' },
        scrapy: { stdout: 'Scrapy 2.11' },
        ffmpeg: { stdout: 'ffmpeg version 6.1' },
        'yt-dlp': { stdout: '2024.12' },
      });

      clearCache();
      const checker = new HealthChecker();
      const report = await checker.getReport();
      expect(report.healthy).toBe(false);
    });
  });
});
