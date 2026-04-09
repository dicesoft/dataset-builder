import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressTracker, ProgressSpinner, formatNumber, formatBytes } from './tui';
import { cleanSnippet } from '../cli/commands/scrape';

// Mock chalk to return plain strings for easier assertion
vi.mock('chalk', () => {
  const passthrough = (s: any) => String(s);
  const chainable: any = new Proxy(passthrough, {
    get: () => chainable,
    apply: (_t: any, _this: any, args: any[]) => String(args[0]),
  });
  return { default: chainable };
});

describe('ProgressTracker', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.stdout.isTTY = true;
    process.stdout.columns = 120;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
    logSpy.mockRestore();
    process.stdout.isTTY = originalIsTTY;
    process.stdout.columns = originalColumns;
  });

  it('should construct with initial state', () => {
    const tracker = new ProgressTracker('test-op', 'task-12345');
    // No output until start() is called
    expect(writeSpy).not.toHaveBeenCalled();
    tracker.stop();
  });

  it('should render on start()', () => {
    const tracker = new ProgressTracker('download');
    tracker.start(10);
    // Should have written to stdout (TTY mode)
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('DOWNLOAD');
    tracker.stop();
  });

  it('should use ANSI cursor-up on 2nd+ render in TTY mode', () => {
    const tracker = new ProgressTracker('scraping');
    tracker.start(5);
    writeSpy.mockClear();

    // Trigger interval render
    vi.advanceTimersByTime(250);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    // Should contain ANSI cursor-up escape codes
    expect(output).toContain('\x1b[1A');
    expect(output).toContain('\x1b[2K');
    tracker.stop();
  });

  it('should update current and message', () => {
    const tracker = new ProgressTracker('scraping');
    tracker.start(5);
    writeSpy.mockClear();

    tracker.update(3, 'processing item 3');
    vi.advanceTimersByTime(250);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('3/5');
    expect(output).toContain('processing item 3');
    tracker.stop();
  });

  it('should increment counter', () => {
    const tracker = new ProgressTracker('test');
    tracker.start(10);
    tracker.increment(3);
    tracker.increment(2);
    writeSpy.mockClear();

    vi.advanceTimersByTime(250);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('5/10');
    tracker.stop();
  });

  it('should setCounters', () => {
    const tracker = new ProgressTracker('test');
    tracker.start(10);
    tracker.setCounters({ urls: 5, records: 3 });
    writeSpy.mockClear();

    vi.advanceTimersByTime(250);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Urls:');
    expect(output).toContain('Records:');
    tracker.stop();
  });

  it('should setPhase', () => {
    const tracker = new ProgressTracker('cleaning');
    tracker.start(4);
    tracker.setPhase('LLM filter');
    writeSpy.mockClear();

    vi.advanceTimersByTime(250);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('LLM filter');
    tracker.stop();
  });

  it('should setMessage', () => {
    const tracker = new ProgressTracker('test');
    tracker.start();
    tracker.setMessage('hello world');
    writeSpy.mockClear();

    vi.advanceTimersByTime(250);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('hello world');
    tracker.stop();
  });

  it('should renderComplete and preserve progress bar', () => {
    const tracker = new ProgressTracker('test');
    tracker.start(5);
    tracker.update(5);
    writeSpy.mockClear();
    logSpy.mockClear();

    tracker.complete('All done!');

    // Should print completion via console.log
    expect(logSpy).toHaveBeenCalled();
    const logOutput = logSpy.mock.calls.map((c) => c[0]).join('');
    expect(logOutput).toContain('COMPLETE');
    expect(logOutput).toContain('All done!');
  });

  it('should renderError and clear previous block', () => {
    const tracker = new ProgressTracker('test');
    tracker.start(5);
    writeSpy.mockClear();
    logSpy.mockClear();

    tracker.error('something broke');

    const logOutput = logSpy.mock.calls.map((c) => c[0]).join('');
    expect(logOutput).toContain('ERROR');
    expect(logOutput).toContain('something broke');
  });

  it('should NOT emit ANSI codes in non-TTY mode', () => {
    process.stdout.isTTY = false as any;
    const tracker = new ProgressTracker('test');
    tracker.start(5);

    // In non-TTY, uses console.log for first render only
    expect(logSpy).toHaveBeenCalledTimes(1);

    writeSpy.mockClear();
    logSpy.mockClear();

    // Subsequent interval renders should be skipped
    vi.advanceTimersByTime(500);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    tracker.stop();
  });

  it('should setTotal() to reset progress for a new phase', () => {
    const tracker = new ProgressTracker('cleaning');
    tracker.start(2); // old wrong total
    tracker.update(1);
    writeSpy.mockClear();

    // Reset for per-record tracking
    tracker.setTotal(34);
    vi.advanceTimersByTime(250);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    // Should show 0/34, not 1/2
    expect(output).toContain('0/34');
    expect(output).not.toContain('1/2');
    tracker.stop();
  });

  it('should show per-record progress after setTotal()', () => {
    const tracker = new ProgressTracker('cleaning');
    tracker.start();
    tracker.setTotal(34);
    tracker.update(17);
    writeSpy.mockClear();

    vi.advanceTimersByTime(250);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('17/34');
    expect(output).toContain('50%');
    tracker.stop();
  });

  it('should reset startTime in setTotal() for accurate ETA', () => {
    const tracker = new ProgressTracker('cleaning');
    tracker.start(2);

    // Advance time, then reset
    vi.advanceTimersByTime(5000);
    tracker.setTotal(10);

    // Advance a little, then update
    vi.advanceTimersByTime(1000);
    tracker.update(5);
    writeSpy.mockClear();

    vi.advanceTimersByTime(250);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    // ETA should be based on ~1s for 5 items = ~1s remaining for 5 items
    // Not based on the original 5s+ elapsed
    expect(output).toContain('ETA:');
    expect(output).toContain('5/10');
    tracker.stop();
  });

  it('should stop cleanly', () => {
    const tracker = new ProgressTracker('test');
    tracker.start(5);
    tracker.stop();

    writeSpy.mockClear();
    vi.advanceTimersByTime(1000);
    // No more renders after stop
    // Only the clear-previous-block writes from stop(), no interval writes
    const intervalOutput = writeSpy.mock.calls.filter((c) => !String(c[0]).includes('\x1b['));
    expect(intervalOutput).toHaveLength(0);
  });

  it('should write trailing newline on stop() in TTY mode', () => {
    const tracker = new ProgressTracker('test');
    tracker.start(5);
    writeSpy.mockClear();

    tracker.stop();

    // Last write should be a newline to ensure cursor is on a clean line
    const calls = writeSpy.mock.calls;
    const lastWrite = calls[calls.length - 1][0];
    expect(lastWrite).toBe('\n');
  });

  it('should NOT write trailing newline on stop() in non-TTY mode', () => {
    process.stdout.isTTY = false as any;
    const tracker = new ProgressTracker('test');
    tracker.start(5);
    writeSpy.mockClear();

    tracker.stop();

    // Non-TTY: no newline written (no stdout.write at all for newline)
    const newlineWrites = writeSpy.mock.calls.filter((c) => c[0] === '\n');
    expect(newlineWrites).toHaveLength(0);
  });
});

describe('ProgressSpinner', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.stdout.isTTY = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
    logSpy.mockRestore();
    process.stdout.isTTY = originalIsTTY;
  });

  it('should start spinning in TTY mode', () => {
    const spinner = new ProgressSpinner('Loading...');
    spinner.start();

    vi.advanceTimersByTime(200);
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Loading...');

    spinner.stop();
  });

  it('should update text', () => {
    const spinner = new ProgressSpinner('Starting...');
    spinner.start();
    spinner.update('Almost done...');

    writeSpy.mockClear();
    vi.advanceTimersByTime(200);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Almost done...');

    spinner.stop();
  });

  it('should stop with success icon', () => {
    const spinner = new ProgressSpinner('Done');
    spinner.start();
    writeSpy.mockClear();

    spinner.stop(true);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Done');
  });

  it('should stop with failure icon', () => {
    const spinner = new ProgressSpinner('Failed');
    spinner.start();
    writeSpy.mockClear();

    spinner.stop(false);
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Failed');
  });

  it('should print once in non-TTY mode', () => {
    process.stdout.isTTY = false as any;
    const spinner = new ProgressSpinner('Processing...');
    spinner.start();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('Processing...');

    vi.advanceTimersByTime(500);
    // No stdout.write calls in non-TTY
    expect(writeSpy).not.toHaveBeenCalled();

    spinner.stop();
  });
});

describe('formatNumber', () => {
  it('should format numbers with locale separators', () => {
    const result = formatNumber(1234567);
    // The exact format depends on locale, but should be a string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatBytes', () => {
  it('should format 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatBytes(512)).toBe('512.00 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
  });

  it('should format gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('should format fractional values', () => {
    expect(formatBytes(1536)).toBe('1.50 KB');
  });
});

describe('cleanSnippet', () => {
  it('should strip [web_link] and [image_link] markers', () => {
    expect(cleanSnippet('Hello [web_link] world [image_link]')).toBe('Hello world');
  });

  it('should strip markdown image links [![alt](img)](url)', () => {
    expect(cleanSnippet('Click [![logo](http://img.png)](http://site.com) here')).toBe(
      'Click here'
    );
  });

  it('should strip markdown links [text](url) keeping text', () => {
    expect(cleanSnippet('Visit [Google](https://google.com) now')).toBe('Visit Google now');
  });

  it('should strip bare markdown images ![alt](url)', () => {
    expect(cleanSnippet('See ![photo](http://img.jpg) below')).toBe('See below');
  });

  it('should decode common HTML entities', () => {
    expect(cleanSnippet('It&#8217;s &amp; that&#8220;s&#8221; fine')).toBe('It\'s & that"s" fine');
  });

  it('should collapse whitespace', () => {
    expect(cleanSnippet('  lots   of    spaces  ')).toBe('lots of spaces');
  });

  it('should handle mixed messy input', () => {
    const messy =
      '[image_link] [![Smart Gas](http://img.png)](http://site.com) Smart Gas Helps&amp;More &#8217;s [web_link]  extra   spaces ';
    const result = cleanSnippet(messy);
    expect(result).not.toContain('[image_link]');
    expect(result).not.toContain('[web_link]');
    expect(result).not.toContain('![');
    expect(result).not.toContain('](');
    expect(result).not.toContain('&amp;');
    expect(result).toContain("Smart Gas Helps&More 's");
  });

  it('should return empty string for empty input', () => {
    expect(cleanSnippet('')).toBe('');
  });
});
