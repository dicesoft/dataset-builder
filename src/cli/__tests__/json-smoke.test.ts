import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setGlobalFlags, outputResult, isJsonMode } from '../../utils/output';

/**
 * Per-command smoke tests (5.8)
 * Tests commands that can run without external dependencies in --json mode.
 * Verifies that outputResult produces valid JSON for each testable path.
 */
describe('Per-command JSON smoke tests (5.8)', () => {
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

  it('config list action produces valid JSON envelope', () => {
    outputResult('config', { action: 'list', config: { host: 'localhost', port: 11434 } });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.version).toBe(1);
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('config');
    expect(parsed.data.action).toBe('list');
  });

  it('config get action produces valid JSON envelope', () => {
    outputResult('config', { action: 'get', key: 'host', value: 'localhost' });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.key).toBe('host');
  });

  it('config set action produces valid JSON envelope', () => {
    outputResult('config', { action: 'set', key: 'host', value: '0.0.0.0', success: true });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.action).toBe('set');
  });

  it('config reset action produces valid JSON envelope', () => {
    outputResult('config', { action: 'reset', success: true });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.action).toBe('reset');
  });

  it('format --list-formats produces valid JSON envelope', () => {
    const formats = [
      { name: 'alpaca', description: 'Alpaca instruction format' },
      { name: 'chatml', description: 'ChatML conversation format' },
    ];
    outputResult('format', { formats });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('format');
    expect(Array.isArray(parsed.data.formats)).toBe(true);
    expect(parsed.data.formats).toHaveLength(2);
  });

  it('format --dry-run produces valid JSON with dry_run flag', () => {
    outputResult('format', {
      dry_run: true,
      command: 'format',
      planned_actions: ['Read input: data.json', 'Format as: alpaca'],
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(Array.isArray(parsed.data.planned_actions)).toBe(true);
  });

  it('scrape result produces valid JSON envelope', () => {
    outputResult(
      'scrape',
      {
        total_results: 50,
        saved_to: './output/task-123/raw',
      },
      { duration_ms: 5000 }
    );

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('scrape');
    expect(parsed.stats.duration_ms).toBe(5000);
  });

  it('generate result produces valid JSON envelope', () => {
    outputResult('generate', {
      records_generated: 100,
      output_file: './output/generated.jsonl',
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('generate');
  });

  it('clean result produces valid JSON envelope', () => {
    outputResult('clean', {
      total: 100,
      kept: 95,
      removed: 5,
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('clean');
  });

  it('transform result produces valid JSON envelope', () => {
    outputResult(
      'transform',
      {
        records_processed: 200,
        records_output: 195,
      },
      { duration_ms: 30000 }
    );

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('transform');
  });

  it('export result produces valid JSON envelope', () => {
    outputResult('export', {
      exported_records: 500,
      output_file: './output/export.csv',
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('export');
  });

  it('import result produces valid JSON envelope', () => {
    outputResult('import', {
      imported_records: 1000,
      source: 'data.csv',
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('import');
  });

  it('prune result produces valid JSON envelope', () => {
    outputResult('prune', {
      files_removed: 10,
      space_freed_bytes: 1048576,
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('prune');
  });

  it('translate result produces valid JSON envelope', () => {
    outputResult('translate', {
      translated: 50,
      source_lang: 'en',
      target_lang: 'ar',
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('translate');
  });

  it('compress result produces valid JSON envelope', () => {
    outputResult('compress', {
      files_compressed: 25,
      saved_bytes: 5242880,
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('compress');
  });

  it('web-search result produces valid JSON envelope', () => {
    outputResult('web-search', {
      query: 'machine learning datasets',
      results: 10,
    });

    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('web-search');
  });

  it('all 14 command names produce valid JSON envelopes', () => {
    const commands = [
      'scrape',
      'generate',
      'clean',
      'transform',
      'translate',
      'compress',
      'resume',
      'config',
      'run',
      'prune',
      'web-search',
      'format',
      'import',
      'export',
    ];

    for (const cmd of commands) {
      stdoutSpy.mockClear();
      outputResult(cmd, { test: true });
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
      expect(parsed.command).toBe(cmd);
      expect(parsed.version).toBe(1);
      expect(parsed.success).toBe(true);
    }
  });
});
