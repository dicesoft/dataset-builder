import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setGlobalFlags, getGlobalFlags } from '../../utils/output';

describe('--dry-run contract tests (5.4)', () => {
  beforeEach(() => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  afterEach(() => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  it('dryRun flag is accessible via getGlobalFlags()', () => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: true });
    expect(getGlobalFlags().dryRun).toBe(true);
  });

  it('dryRun defaults to false', () => {
    expect(getGlobalFlags().dryRun).toBe(false);
  });

  it('dryRun flag is independent of other flags', () => {
    setGlobalFlags({ json: true, quiet: true, yes: true, verbose: true, dryRun: true });
    const flags = getGlobalFlags();
    expect(flags.dryRun).toBe(true);
    expect(flags.json).toBe(true);
    expect(flags.quiet).toBe(true);
  });

  it('dryRun flag survives flag mutation', () => {
    const original = { json: false, quiet: false, yes: false, verbose: false, dryRun: true };
    setGlobalFlags(original);
    original.dryRun = false; // mutate original
    expect(getGlobalFlags().dryRun).toBe(true); // should still be true
  });
});
