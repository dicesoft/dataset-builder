import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DownloadProgress } from './types';

// Mock chalk to return plain strings
vi.mock('chalk', () => {
  const handler: ProxyHandler<object> = {
    get: () => new Proxy((s: string) => s, handler),
    apply: (_t, _thisArg, args) => args[0],
  };
  return { default: new Proxy({}, handler) };
});

function makeProgress(overrides: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    index: 0,
    url: 'https://example.com/file.jpg',
    filename: 'file.jpg',
    status: 'downloading',
    progress: 50,
    bytesDownloaded: 500,
    totalBytes: 1000,
    startTime: Date.now() - 1000,
    ...overrides,
  };
}

describe('downloader/tui - progress bar clamping', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    writeSpy.mockRestore();
    logSpy.mockRestore();
  });

  async function loadTUI() {
    const mod = await import('./tui');
    // Reset throttle by creating TUI fresh
    mod.createTUI(1);
    // Wait past the 100ms throttle
    await new Promise((r) => setTimeout(r, 110));
    return mod;
  }

  it('should not throw when progress > 100%', async () => {
    const { updateProgress } = await loadTUI();
    expect(() => updateProgress([makeProgress({ progress: 150 })])).not.toThrow();
  });

  it('should not throw when progress is negative', async () => {
    const { updateProgress } = await loadTUI();
    expect(() => updateProgress([makeProgress({ progress: -20 })])).not.toThrow();
  });

  it('should not throw when progress is NaN', async () => {
    const { updateProgress } = await loadTUI();
    expect(() => updateProgress([makeProgress({ progress: NaN })])).not.toThrow();
  });

  it('should not throw when progress is exactly 100%', async () => {
    const { updateProgress } = await loadTUI();
    expect(() => updateProgress([makeProgress({ progress: 100 })])).not.toThrow();
  });

  it('should not throw when progress is 0%', async () => {
    const { updateProgress } = await loadTUI();
    expect(() => updateProgress([makeProgress({ progress: 0 })])).not.toThrow();
  });
});
