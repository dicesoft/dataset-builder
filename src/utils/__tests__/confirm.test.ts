import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { confirm } from '../confirm';
import { setGlobalFlags, isYesMode } from '../output';

describe('confirm', () => {
  beforeEach(() => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    delete process.env.YES;
    delete process.env.CI;
  });

  afterEach(() => {
    delete process.env.YES;
    delete process.env.CI;
  });

  it('should return true when yes flag is set', async () => {
    setGlobalFlags({ json: false, quiet: false, yes: true, verbose: false, dryRun: false });
    expect(await confirm('Delete files?')).toBe(true);
  });

  it('should return true when YES env is set', async () => {
    process.env.YES = 'true';
    expect(await confirm('Delete files?')).toBe(true);
  });

  it('should return true when CI env is set', async () => {
    process.env.CI = 'true';
    expect(await confirm('Proceed?')).toBe(true);
  });

  it('should return true for empty input when defaultYes is true', async () => {
    const mockRl = {
      question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('')),
      close: vi.fn(),
    };
    vi.doMock('readline', () => ({
      createInterface: () => mockRl,
    }));

    // Re-import to pick up the mock
    const { confirm: confirmMocked } = await import('../confirm');
    const result = await confirmMocked('Continue?', true);
    expect(result).toBe(true);

    vi.doUnmock('readline');
  });

  it('should return false for empty input when defaultYes is false', async () => {
    const mockRl = {
      question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('')),
      close: vi.fn(),
    };
    vi.doMock('readline', () => ({
      createInterface: () => mockRl,
    }));

    const { confirm: confirmMocked } = await import('../confirm');
    const result = await confirmMocked('Delete everything?', false);
    expect(result).toBe(false);

    vi.doUnmock('readline');
  });

  it('should return true for "y" input', async () => {
    const mockRl = {
      question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('y')),
      close: vi.fn(),
    };
    vi.doMock('readline', () => ({
      createInterface: () => mockRl,
    }));

    const { confirm: confirmMocked } = await import('../confirm');
    const result = await confirmMocked('Continue?', false);
    expect(result).toBe(true);

    vi.doUnmock('readline');
  });

  it('should return false for "n" input when defaultYes is true', async () => {
    const mockRl = {
      question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('n')),
      close: vi.fn(),
    };
    vi.doMock('readline', () => ({
      createInterface: () => mockRl,
    }));

    const { confirm: confirmMocked } = await import('../confirm');
    const result = await confirmMocked('Continue?', true);
    expect(result).toBe(false);

    vi.doUnmock('readline');
  });

  describe('--json implies --yes (5.5)', () => {
    it('should auto-accept when JSON mode is active (--json implies --yes)', async () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      // setGlobalFlags with json=true automatically sets yes=true
      const result = await confirm('Delete everything?');
      expect(result).toBe(true);
    });

    it('isYesMode returns true when --json is set', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      expect(isYesMode()).toBe(true);
    });

    it('confirm auto-accepts with defaultYes=false when JSON mode is active', async () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      const result = await confirm('Dangerous operation?', false);
      expect(result).toBe(true);
    });
  });
});
