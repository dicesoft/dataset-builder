import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setGlobalFlags, outputResult, outputError, isJsonMode } from '../../utils/output';

describe('JSON stdout isolation (5.1)', () => {
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

  it('isJsonMode returns true when --json flag is set', () => {
    expect(isJsonMode()).toBe(true);
  });

  it('outputResult produces valid JSON on stdout', () => {
    outputResult('test-cmd', { foo: 'bar' });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.trim());
    expect(parsed).toMatchObject({
      version: 1,
      success: true,
      command: 'test-cmd',
      data: { foo: 'bar' },
    });
  });

  it('outputResult writes only JSON — no extra text on stdout', () => {
    outputResult('scrape', { records: 10 });

    // Every stdout.write call must be valid JSON
    for (const call of stdoutSpy.mock.calls) {
      const line = (call[0] as string).trim();
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('outputError produces valid JSON on stdout', () => {
    outputError('INVALID_INPUT', 'Missing --input');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.trim());
    expect(parsed).toMatchObject({
      version: 1,
      error: true,
      code: 'INVALID_INPUT',
      message: 'Missing --input',
    });
  });

  it('outputResult includes stats when provided', () => {
    outputResult('transform', { count: 5 }, { duration_ms: 999 });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.stats).toEqual({ duration_ms: 999 });
  });

  it('outputResult omits stats when not provided', () => {
    outputResult('generate', { count: 10 });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.stats).toBeUndefined();
  });

  it('outputError includes details when provided', () => {
    outputError('INVALID_INPUT', 'Bad field', { field: 'name' });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.details).toEqual({ field: 'name' });
  });

  it('outputError omits details when not provided', () => {
    outputError('GENERAL_ERROR', 'Oops');

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.details).toBeUndefined();
  });

  it('outputResult is no-op when not in JSON mode', () => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    outputResult('scrape', { records: 42 });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('outputError is no-op when not in JSON mode', () => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    outputError('GENERAL_ERROR', 'nope');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('JSON envelope has version field set to 1', () => {
    outputResult('config', { action: 'list' });
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.version).toBe(1);
  });

  it('error envelope has version field set to 1', () => {
    outputError('GENERAL_ERROR', 'fail');
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.version).toBe(1);
  });
});
