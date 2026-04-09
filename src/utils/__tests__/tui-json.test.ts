import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setGlobalFlags } from '../output';
import { ProgressTracker } from '../tui';

describe('ProgressTracker JSON mode (5.2)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  it('does NOT write TUI progress to stdout in JSON mode', () => {
    const tracker = new ProgressTracker('test-op');
    tracker.start(10);
    tracker.update(5);
    // Force a render cycle by calling complete
    tracker.complete('done');

    // stdout should have NO TUI progress output
    // (outputResult is not called by ProgressTracker itself)
    for (const call of stdoutSpy.mock.calls) {
      const text = call[0] as string;
      // Should not contain TUI characters like === or progress bars
      expect(text).not.toMatch(/===.*===$/m);
    }
  });

  it('emits CompletionEvent to stderr on .complete() in JSON mode', () => {
    const tracker = new ProgressTracker('transform');
    tracker.start(100);
    tracker.update(100);
    tracker.complete('Processed 100 records');

    // Find the completion event in stderr calls
    const completionCalls = stderrSpy.mock.calls.filter((call) => {
      try {
        const parsed = JSON.parse((call[0] as string).trim());
        return parsed.type === 'complete';
      } catch {
        return false;
      }
    });

    expect(completionCalls.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse((completionCalls[0][0] as string).trim());
    expect(event).toMatchObject({
      type: 'complete',
      phase: 'transform',
      summary: 'Processed 100 records',
    });
    expect(event.duration_ms).toBeTypeOf('number');
    expect(event.timestamp).toBeTypeOf('string');
  });

  it('emits CompletionEvent with null summary when none provided', () => {
    const tracker = new ProgressTracker('clean');
    tracker.start(5);
    tracker.complete();

    const completionCalls = stderrSpy.mock.calls.filter((call) => {
      try {
        const parsed = JSON.parse((call[0] as string).trim());
        return parsed.type === 'complete';
      } catch {
        return false;
      }
    });

    expect(completionCalls.length).toBeGreaterThanOrEqual(1);
    const event = JSON.parse((completionCalls[0][0] as string).trim());
    expect(event.type).toBe('complete');
    expect(event.summary).toBeNull();
  });

  it('emits NDJSON progress events to stderr (not stdout)', () => {
    const tracker = new ProgressTracker('scrape');
    tracker.start(50);

    // Manually trigger a render by calling the internal render via update + time
    // The render method checks isJsonMode and emits NDJSON to stderr
    // We need to force a render — calling start already triggers one
    tracker.complete('done');

    // Check stderr has NDJSON lines
    const stderrLines = stderrSpy.mock.calls.map((c) => (c[0] as string).trim());
    for (const line of stderrLines) {
      if (line.length > 0) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }
  });

  it('does not emit TUI renderComplete in JSON mode', () => {
    const tracker = new ProgressTracker('generate');
    tracker.start(10);
    tracker.complete('Generated 10 items');

    // stdout should NOT have "COMPLETE" TUI text
    for (const call of stdoutSpy.mock.calls) {
      const text = call[0] as string;
      expect(text).not.toContain('COMPLETE');
    }
  });

  it('does not emit TUI renderError in JSON mode', () => {
    const tracker = new ProgressTracker('translate');
    tracker.start(5);
    tracker.error('Connection failed');

    // stdout should NOT have "ERROR" TUI text
    for (const call of stdoutSpy.mock.calls) {
      const text = call[0] as string;
      expect(text).not.toContain('ERROR');
    }
  });
});
