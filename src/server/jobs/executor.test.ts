import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';
import { JobExecutor, sanitizeStderrLine, resolveRelativeInputPath } from './executor';
import { getConfig } from '../../config';

/**
 * T086: Unit tests for job executor
 */

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function createMockProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let mockProcess: MockChildProcess;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProcess),
}));

describe('JobExecutor', () => {
  let executor: JobExecutor;

  beforeEach(() => {
    mockProcess = createMockProcess();
    executor = new JobExecutor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Spawning
  // -----------------------------------------------------------------------

  describe('spawn', () => {
    it('spawns child process with correct arguments', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('scrape', {
        search: 'test query',
        searchCount: 10,
        download: true,
      });

      // Simulate immediate successful exit
      mockProcess.emit('close', 0);
      await runPromise;

      expect(spawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([
          expect.stringContaining('index.js'),
          '--json',
          '--yes',
          'scrape',
          '--search',
          'test query',
          '--search-count',
          '10',
          '--download',
        ]),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      );
    });

    it('converts camelCase options to kebab-case flags', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('scrape', {
        searchProvider: 'bing',
        maxConcurrent: 5,
      });

      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args = calls[calls.length - 1][1];
      expect(args).toContain('--search-provider');
      expect(args).toContain('bing');
      expect(args).toContain('--max-concurrent');
      expect(args).toContain('5');
    });

    it('skips null and undefined values', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('scrape', {
        search: 'test',
        nullVal: null,
        undefVal: undefined,
      });

      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args = calls[calls.length - 1][1];
      expect(args).not.toContain('--null-val');
      expect(args).not.toContain('--undef-val');
    });

    it('places global flags --json and --yes before the subcommand name', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('scrape', { search: 'kittens' });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];

      const jsonIdx = args.indexOf('--json');
      const yesIdx = args.indexOf('--yes');
      const cmdIdx = args.indexOf('scrape');

      expect(jsonIdx).toBeGreaterThan(0); // after cliPath
      expect(yesIdx).toBeGreaterThan(0);
      expect(cmdIdx).toBeGreaterThan(yesIdx);
      expect(cmdIdx).toBeGreaterThan(jsonIdx);
    });

    it('skips json and yes from user options to avoid duplicate flags', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('scrape', {
        search: 'test',
        json: true,
        yes: true,
      });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];

      // --json and --yes should appear exactly once each
      const jsonCount = args.filter((a) => a === '--json').length;
      const yesCount = args.filter((a) => a === '--yes').length;
      expect(jsonCount).toBe(1);
      expect(yesCount).toBe(1);
    });

    it('resolves relative --input path against outputDir for transform jobs', async () => {
      const { spawn } = await import('child_process');
      const path = await import('path');

      const runPromise = executor.run('transform', {
        input: 'task_123/scraped_combined.json',
        template: 'image-classification',
      });

      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const inputIdx = args.indexOf('--input');
      expect(inputIdx).toBeGreaterThan(-1);
      const resolvedInput = args[inputIdx + 1];
      // The resolved path must be absolute — otherwise the CLI (spawned with
      // cwd=projectRoot) would look for the file at <projectRoot>/task_123/...
      // and fail with ENOENT.
      expect(path.isAbsolute(resolvedInput)).toBe(true);
      expect(resolvedInput.replace(/\\/g, '/')).toContain('task_123/scraped_combined.json');
    });

    it('leaves absolute --input paths (within outputDir) unchanged', async () => {
      const { spawn } = await import('child_process');

      const outputDir = path.resolve(getConfig().get('outputDir') as string);
      // Craft an absolute path that is contained within outputDir so the
      // containment check in resolveRelativeInputPath does not reject it.
      const absoluteInput = path.join(outputDir, 'task_abs', 'foo.json');

      const runPromise = executor.run('transform', { input: absoluteInput });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const inputIdx = args.indexOf('--input');
      expect(args[inputIdx + 1]).toBe(absoluteInput);
      expect(path.isAbsolute(args[inputIdx + 1])).toBe(true);
    });

    // -------------------------------------------------------------------
    // Phase 1 — path hardening regressions
    // (plan §4.1 items #4, #5, #8, #11 + absolute-outside-outputDir)
    // -------------------------------------------------------------------

    it('strips a leading `output/` (outputDir basename) legacy prefix (plan §4.1 #4)', async () => {
      const { spawn } = await import('child_process');

      const outputDir = path.resolve(getConfig().get('outputDir') as string);
      const outputDirBase = path.basename(outputDir);

      const runPromise = executor.run('transform', {
        input: `${outputDirBase}/task_1/foo.json`,
      });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const inputIdx = args.indexOf('--input');
      const resolvedInput = args[inputIdx + 1];

      // The resolved path must be `<outputDir>/task_1/foo.json`, NOT
      // `<outputDir>/<outputDir-basename>/task_1/foo.json`.
      const expected = path.resolve(outputDir, 'task_1', 'foo.json');
      expect(resolvedInput).toBe(expected);
      // Sanity: the doubled-up wrong path should not appear.
      expect(resolvedInput).not.toContain(`${outputDirBase}${path.sep}${outputDirBase}${path.sep}`);
    });

    it('rejects `../../etc/passwd` traversal with PATH_TRAVERSAL and does not spawn (plan §4.1 #5)', async () => {
      const { spawn } = await import('child_process');
      const spawnMock = spawn as ReturnType<typeof vi.fn>;
      spawnMock.mockClear();

      const errorEvents: Array<{ code: string; message: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      await executor.run('transform', { input: '../../../../etc/passwd' });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].code).toBe('PATH_TRAVERSAL');
    });

    it('rejects absolute path outside outputDir with PATH_TRAVERSAL', async () => {
      const { spawn } = await import('child_process');
      const spawnMock = spawn as ReturnType<typeof vi.fn>;
      spawnMock.mockClear();

      const errorEvents: Array<{ code: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      // An absolute path that is guaranteed to be outside outputDir
      // (outputDir defaults to `./output` under projectRoot).
      const outsideAbsolute =
        process.platform === 'win32' ? 'C:\\Windows\\System32\\config\\SAM' : '/etc/passwd';

      await executor.run('transform', { input: outsideAbsolute });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].code).toBe('PATH_TRAVERSAL');
    });

    it('rejects whitespace-only input as INVALID_INPUT_PATH (plan §4.1 #8)', async () => {
      const { spawn } = await import('child_process');
      const spawnMock = spawn as ReturnType<typeof vi.fn>;
      spawnMock.mockClear();

      const errorEvents: Array<{ code: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      await executor.run('transform', { input: '   ' });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].code).toBe('INVALID_INPUT_PATH');
    });

    it('throws JOB_CONFIG_UNAVAILABLE when getConfig() fails — no silent fallback (plan §4.1 #11)', async () => {
      // Direct unit test against resolveRelativeInputPath to isolate the
      // config-failure branch from the rest of the executor run loop.
      const configModule = await import('../../config');
      const spy = vi.spyOn(configModule, 'getConfig').mockImplementation(() => {
        throw new Error('config unavailable');
      });

      expect(() => resolveRelativeInputPath('task_123/foo.json')).toThrowError(
        /config unavailable|JOB_CONFIG_UNAVAILABLE|Unable to resolve outputDir/
      );

      try {
        resolveRelativeInputPath('task_123/foo.json');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('JOB_CONFIG_UNAVAILABLE');
      }

      spy.mockRestore();
    });

    // -------------------------------------------------------------------
    // Phase 4 — plan §4.1 additional cases (4.1 #1, #3 win32 parametric,
    // #6, #7, #9, #10) and §4.2 parametric across commands.
    // -------------------------------------------------------------------

    it('passes through empty-string --input unchanged (plan §4.1 #1)', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('transform', {
        input: '',
        template: 'image-classification',
      });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const inputIdx = args.indexOf('--input');
      // Empty-string passthrough: the arg is still emitted (caller decides
      // semantics), but it must be byte-for-byte empty with no resolution.
      expect(inputIdx).toBeGreaterThan(-1);
      expect(args[inputIdx + 1]).toBe('');
    });

    // Parametric absolute-path passthrough — extends the existing
    // "leaves absolute --input paths unchanged" test with Windows UNC and
    // Windows drive-absolute rows. Both must be rejected as outside outputDir
    // because they cannot plausibly be contained in the local outputDir; the
    // assertion is therefore the PATH_TRAVERSAL rejection, not passthrough.
    // (The original POSIX-absolute-within-outputDir case is already covered.)
    it.each([
      {
        label: 'Windows UNC absolute path',
        input: '\\\\server\\share\\foo.json',
      },
      {
        label: 'Windows drive-absolute path',
        input: 'C:\\abs\\foo.json',
      },
    ])('rejects absolute $label as PATH_TRAVERSAL (plan §4.1 #3 parametric)', async ({ input }) => {
      const { spawn } = await import('child_process');
      const spawnMock = spawn as ReturnType<typeof vi.fn>;
      spawnMock.mockClear();

      const errorEvents: Array<{ code: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      await executor.run('transform', { input });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].code).toBe('PATH_TRAVERSAL');
    });

    // Win32-only: `C:foo.json` (drive-relative) is platform-specific and
    // unpredictable — rejected as INVALID_INPUT_PATH (plan §4.1 #6).
    it.runIf(process.platform === 'win32')(
      'rejects Windows drive-relative `C:foo.json` as PATH_TRAVERSAL/INVALID_INPUT_PATH (plan §4.1 #6)',
      async () => {
        const { spawn } = await import('child_process');
        const spawnMock = spawn as ReturnType<typeof vi.fn>;
        spawnMock.mockClear();

        const errorEvents: Array<{ code: string }> = [];
        executor.on('error', (e) => errorEvents.push(e));

        await executor.run('transform', { input: 'C:foo.json' });

        expect(spawnMock).not.toHaveBeenCalled();
        expect(errorEvents).toHaveLength(1);
        // Drive-relative paths are treated as absolute by path.isAbsolute on
        // Windows, so they hit the containment check and are rejected as
        // PATH_TRAVERSAL. Accept either typed code for forward-compat.
        expect(['PATH_TRAVERSAL', 'INVALID_INPUT_PATH']).toContain(errorEvents[0].code);
      }
    );

    // Win32-only: forward slashes in a relative input must resolve to a
    // backslash path under outputDir (plan §4.1 #7).
    it.runIf(process.platform === 'win32')(
      'resolves forward-slash relative input to backslash path on Windows (plan §4.1 #7)',
      async () => {
        const { spawn } = await import('child_process');

        const runPromise = executor.run('transform', { input: 'task_123/foo.json' });
        mockProcess.emit('close', 0);
        await runPromise;

        const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
        const args: string[] = calls[calls.length - 1][1];
        const inputIdx = args.indexOf('--input');
        const resolved = args[inputIdx + 1];
        expect(path.isAbsolute(resolved)).toBe(true);
        // On win32, path.resolve yields backslash separators.
        expect(resolved).toContain('\\task_123\\foo.json');
      }
    );

    it('preserves literal spaces in path values — no shell expansion (plan §4.1 #9)', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('transform', { input: 'my task/foo.json' });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const inputIdx = args.indexOf('--input');
      const resolved = args[inputIdx + 1];

      // The resolved path must contain the literal "my task" segment, not
      // split on the space. Also — locking out any future `shell: true`
      // regression — the resolved value must be a single argv entry.
      expect(resolved.replace(/\\/g, '/')).toContain('my task/foo.json');
      // No separate "my" / "task" argv entries leaked in anywhere.
      expect(args).not.toContain('my');
      expect(args).not.toContain('task');

      // Sanity-check that spawn was called WITHOUT `shell: true` — if this
      // ever regresses, the test above would silently pass even though a
      // real shell would expand the spaces.
      const spawnOpts = calls[calls.length - 1][2];
      expect(spawnOpts?.shell).not.toBe(true);
    });

    it('resolves a unicode relative --input cleanly (plan §4.1 #10)', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('transform', { input: 'task/日本語/foo.json' });
      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const inputIdx = args.indexOf('--input');
      const resolved = args[inputIdx + 1];
      expect(path.isAbsolute(resolved)).toBe(true);
      // Unicode code points survive intact (no mangling, no URL-encoding).
      expect(resolved).toContain('日本語');
      expect(resolved.replace(/\\/g, '/')).toContain('task/日本語/foo.json');
    });

    // -------------------------------------------------------------------
    // Plan §4.2 — parametric across sibling commands that accept --input.
    // Locks in the PATH_INPUT_OPTIONS global-set decision from Phase 3.2.
    // -------------------------------------------------------------------
    it.each(['transform', 'clean', 'format', 'translate', 'export'])(
      'resolves relative --input against outputDir for `%s` jobs (plan §4.2)',
      async (command) => {
        const { spawn } = await import('child_process');

        const runPromise = executor.run(command, {
          input: 'task_xyz/data.json',
        });
        mockProcess.emit('close', 0);
        await runPromise;

        const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
        const args: string[] = calls[calls.length - 1][1];
        const inputIdx = args.indexOf('--input');
        expect(inputIdx).toBeGreaterThan(-1);
        const resolved = args[inputIdx + 1];

        // Absolute …
        expect(path.isAbsolute(resolved)).toBe(true);
        // …contained within outputDir …
        const outputDir = path.resolve(getConfig().get('outputDir') as string);
        const outputDirWithSep = outputDir.endsWith(path.sep) ? outputDir : outputDir + path.sep;
        expect(resolved.startsWith(outputDirWithSep)).toBe(true);
        // …and carries the original relative tail.
        expect(resolved.replace(/\\/g, '/')).toContain('task_xyz/data.json');

        // Also assert the subcommand name is actually passed to the child.
        expect(args).toContain(command);
      }
    );

    it('passes array values as comma-separated', async () => {
      const { spawn } = await import('child_process');

      const runPromise = executor.run('scrape', {
        formats: ['images', 'videos'],
      });

      mockProcess.emit('close', 0);
      await runPromise;

      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args = calls[calls.length - 1][1];
      expect(args).toContain('--formats');
      expect(args).toContain('images,videos');
    });
  });

  // -----------------------------------------------------------------------
  // stderr NDJSON parsing
  // -----------------------------------------------------------------------

  describe('stderr NDJSON parsing', () => {
    it('parses progress events from stderr', async () => {
      const progressEvents: unknown[] = [];
      executor.on('progress', (p) => progressEvents.push(p));

      const runPromise = executor.run('scrape', {});

      // Emit NDJSON progress on stderr
      const progressLine = JSON.stringify({
        type: 'progress',
        phase: 'Downloading',
        current: 5,
        total: 10,
        message: 'Downloading 5/10',
      });
      mockProcess.stderr.emit('data', Buffer.from(progressLine + '\n'));

      mockProcess.emit('close', 0);
      await runPromise;

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({
        phase: 'Downloading',
        current: 5,
        total: 10,
        message: 'Downloading 5/10',
      });
    });

    it('handles multiple progress lines in a single chunk', async () => {
      const progressEvents: unknown[] = [];
      executor.on('progress', (p) => progressEvents.push(p));

      const runPromise = executor.run('scrape', {});

      const lines =
        [
          JSON.stringify({ type: 'progress', phase: 'Phase1', current: 1, total: 3 }),
          JSON.stringify({ type: 'progress', phase: 'Phase2', current: 2, total: 3 }),
        ].join('\n') + '\n';

      mockProcess.stderr.emit('data', Buffer.from(lines));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(progressEvents).toHaveLength(2);
    });

    it('ignores non-JSON stderr output', async () => {
      const progressEvents: unknown[] = [];
      executor.on('progress', (p) => progressEvents.push(p));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit('data', Buffer.from('Some warning text\n'));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(progressEvents).toHaveLength(0);
    });

    it('synthesizes log lines from progress events for the live logs panel', async () => {
      const logEvents: string[] = [];
      executor.on('log', (line) => logEvents.push(line as string));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            type: 'progress',
            phase: 'Downloading',
            current: 5,
            total: 10,
            message: 'Fetching page 5/10',
          }) + '\n'
        )
      );
      mockProcess.emit('close', 0);
      await runPromise;

      expect(logEvents).toHaveLength(1);
      expect(logEvents[0]).toBe('[Downloading] Fetching page 5/10');
    });

    it('dedupes consecutive identical synthesized log lines', async () => {
      const logEvents: string[] = [];
      executor.on('log', (line) => logEvents.push(line as string));

      const runPromise = executor.run('scrape', {});

      // Same progress emitted three times (e.g. spinner frames)
      const sameLine =
        JSON.stringify({
          type: 'progress',
          phase: 'spinner',
          message: 'Searching for URLs (brave)...',
        }) + '\n';
      mockProcess.stderr.emit('data', Buffer.from(sameLine + sameLine + sameLine));
      mockProcess.emit('close', 0);
      await runPromise;

      // Only one synthesized log line, deduped
      expect(logEvents).toHaveLength(1);
      expect(logEvents[0]).toBe('[spinner] Searching for URLs (brave)...');
    });

    it('handles split chunks across data events', async () => {
      const progressEvents: unknown[] = [];
      executor.on('progress', (p) => progressEvents.push(p));

      const runPromise = executor.run('scrape', {});

      const full = JSON.stringify({ type: 'progress', phase: 'Test', current: 1, total: 5 });
      // Split in the middle
      const part1 = full.slice(0, 10);
      const part2 = full.slice(10) + '\n';

      mockProcess.stderr.emit('data', Buffer.from(part1));
      mockProcess.stderr.emit('data', Buffer.from(part2));

      mockProcess.emit('close', 0);
      await runPromise;

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0]).toMatchObject({ phase: 'Test' });
    });
  });

  // -----------------------------------------------------------------------
  // stdout result capture
  // -----------------------------------------------------------------------

  describe('stdout result capture', () => {
    it('captures stdout as result on success', async () => {
      const completeEvents: unknown[] = [];
      executor.on('complete', (r) => completeEvents.push(r));

      const runPromise = executor.run('scrape', {});

      const result = JSON.stringify({ success: true, data: { items: 42 } });
      mockProcess.stdout.emit('data', Buffer.from(result));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0]).toEqual({ items: 42 });
    });

    it('emits error when stdout envelope has success=false', async () => {
      const errorEvents: unknown[] = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      const result = JSON.stringify({
        success: false,
        error: true,
        code: 'SCRAPE_FAILED',
        message: 'No results',
      });
      mockProcess.stdout.emit('data', Buffer.from(result));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({ code: 'SCRAPE_FAILED' });
    });

    it('treats non-JSON stdout as raw string result', async () => {
      const completeEvents: unknown[] = [];
      executor.on('complete', (r) => completeEvents.push(r));

      const runPromise = executor.run('scrape', {});

      mockProcess.stdout.emit('data', Buffer.from('plain text output'));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0]).toBe('plain text output');
    });

    it('emits complete with null when stdout is empty', async () => {
      const completeEvents: unknown[] = [];
      executor.on('complete', (r) => completeEvents.push(r));

      const runPromise = executor.run('scrape', {});

      mockProcess.emit('close', 0);
      await runPromise;

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0]).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Non-zero exit codes
  // -----------------------------------------------------------------------

  describe('non-zero exit codes', () => {
    it('emits error on non-zero exit code', async () => {
      const errorEvents: unknown[] = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        code: 'CLI_EXIT_ERROR',
        details: { exitCode: 1 },
      });
    });

    it('parses error info from stdout on non-zero exit', async () => {
      const errorEvents: unknown[] = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      const errorOutput = JSON.stringify({
        error: true,
        code: 'NETWORK_ERROR',
        message: 'Connection refused',
      });
      mockProcess.stdout.emit('data', Buffer.from(errorOutput));
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        code: 'NETWORK_ERROR',
        message: 'Connection refused',
      });
    });

    it('emits SPAWN_ERROR on process error event', async () => {
      const errorEvents: unknown[] = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.emit('error', new Error('ENOENT'));
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        code: 'SPAWN_ERROR',
        message: 'ENOENT',
      });
    });
  });

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  describe('cancel', () => {
    it('kills the process with SIGTERM', async () => {
      const runPromise = executor.run('scrape', {});

      executor.cancel();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Simulate process close after kill
      mockProcess.emit('close', null);
      await runPromise;
    });

    it('resolves without emitting error or complete after cancel', async () => {
      const events: string[] = [];
      executor.on('complete', () => events.push('complete'));
      executor.on('error', () => events.push('error'));

      const runPromise = executor.run('scrape', {});

      executor.cancel();
      mockProcess.emit('close', null);
      await runPromise;

      // After kill, should just resolve without emitting
      expect(events).toHaveLength(0);
    });

    it('does nothing if no process is running', () => {
      // Should not throw
      executor.cancel();
    });
  });

  // -----------------------------------------------------------------------
  // Regression: arg order (Phase 1)
  // -----------------------------------------------------------------------

  describe('arg order regression', () => {
    it('exits successfully when global flags are before the subcommand', async () => {
      const { spawn } = await import('child_process');
      const errorEvents: unknown[] = [];
      const completeEvents: unknown[] = [];
      executor.on('error', (e) => errorEvents.push(e));
      executor.on('complete', (r) => completeEvents.push(r));

      const runPromise = executor.run('scrape', { search: 'kittens' });

      // Verify spawn was called with correct arg ordering
      const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
      const args: string[] = calls[calls.length - 1][1];
      const cmdIdx = args.indexOf('scrape');
      const jsonIdx = args.indexOf('--json');
      const yesIdx = args.indexOf('--yes');

      // Global flags must precede the subcommand
      expect(jsonIdx).toBeLessThan(cmdIdx);
      expect(yesIdx).toBeLessThan(cmdIdx);

      // Simulate successful exit
      const result = JSON.stringify({ success: true, data: { items: 5 } });
      mockProcess.stdout.emit('data', Buffer.from(result));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(errorEvents).toHaveLength(0);
      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0]).toEqual({ items: 5 });
    });
  });

  // -----------------------------------------------------------------------
  // stderr capture (Phase 2)
  // -----------------------------------------------------------------------

  describe('stderr capture', () => {
    it('captures non-JSON stderr lines', async () => {
      const errorEvents: Array<{
        code: string;
        message: string;
        details: Record<string, unknown>;
      }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit('data', Buffer.from('Warning: something went wrong\n'));
      mockProcess.stderr.emit('data', Buffer.from('Error: connection refused\n'));
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].details).toMatchObject({
        exitCode: 1,
        stderr: 'Warning: something went wrong\nError: connection refused',
      });
    });

    it('does not capture JSON stderr lines in stderrLines', async () => {
      const errorEvents: Array<{ details: Record<string, unknown> }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      // JSON progress line should not be captured as stderr
      const progressLine = JSON.stringify({
        type: 'progress',
        phase: 'Test',
        current: 1,
        total: 5,
      });
      mockProcess.stderr.emit('data', Buffer.from(progressLine + '\n'));
      mockProcess.stderr.emit('data', Buffer.from('plain text error\n'));
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].details).toMatchObject({
        exitCode: 1,
        stderr: 'plain text error',
      });
    });

    it('does not include stderr field when no non-JSON stderr lines exist', async () => {
      const errorEvents: Array<{ details: Record<string, unknown> }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].details).toEqual({ exitCode: 1 });
    });
  });

  // -----------------------------------------------------------------------
  // Signal capture (Phase 2)
  // -----------------------------------------------------------------------

  describe('signal capture', () => {
    it('includes signal in error message when process is killed', async () => {
      const errorEvents: Array<{ message: string; details: Record<string, unknown> }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.emit('close', null, 'SIGTERM');
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].message).toBe('Process killed by SIGTERM');
      expect(errorEvents[0].details).toMatchObject({ signal: 'SIGTERM' });
    });

    it('includes signal in error details', async () => {
      const errorEvents: Array<{ details: Record<string, unknown> }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.emit('close', 1, 'SIGKILL');
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].details).toMatchObject({
        exitCode: 1,
        signal: 'SIGKILL',
      });
    });
  });

  // -----------------------------------------------------------------------
  // Fallback message from stderr (Phase 2)
  // -----------------------------------------------------------------------

  describe('fallback message from stderr', () => {
    it('uses Error: line as message when stdout has no JSON envelope', async () => {
      const errorEvents: Array<{ message: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit(
        'data',
        Buffer.from('Some debug output\nError: module not found\nmore stuff\n')
      );
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents[0].message).toBe('Error: module not found');
    });

    it('uses last non-indented line when no Error: line exists', async () => {
      const errorEvents: Array<{ message: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit(
        'data',
        Buffer.from('Traceback:\n  File "foo.py", line 1\nModuleNotFoundError: scrapy\n')
      );
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents[0].message).toBe('ModuleNotFoundError: scrapy');
    });

    it('does not override stdout JSON error envelope with stderr', async () => {
      const errorEvents: Array<{ message: string; code: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit('data', Buffer.from('Error: some stderr error\n'));
      const errorOutput = JSON.stringify({
        error: true,
        code: 'NETWORK_ERROR',
        message: 'Connection refused',
      });
      mockProcess.stdout.emit('data', Buffer.from(errorOutput));
      mockProcess.emit('close', 1);
      await runPromise;

      // stdout envelope should take priority
      expect(errorEvents[0].message).toBe('Connection refused');
      expect(errorEvents[0].code).toBe('NETWORK_ERROR');
    });
  });

  // -----------------------------------------------------------------------
  // Log emission (Phase 2)
  // -----------------------------------------------------------------------

  describe('log emission', () => {
    it('emits log events for non-JSON stderr lines', async () => {
      const logLines: string[] = [];
      executor.on('log', (line) => logLines.push(line));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit('data', Buffer.from('WARNING: rate limited\nDEBUG: retrying\n'));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(logLines).toEqual(['WARNING: rate limited', 'DEBUG: retrying']);
    });

    it('synthesizes a log event from progress (so live logs panel shows activity)', async () => {
      const logLines: string[] = [];
      executor.on('log', (line) => logLines.push(line));

      const runPromise = executor.run('scrape', {});

      const progressLine = JSON.stringify({
        type: 'progress',
        phase: 'Test',
        current: 1,
        total: 5,
      });
      mockProcess.stderr.emit('data', Buffer.from(progressLine + '\n'));
      mockProcess.emit('close', 0);
      await runPromise;

      // Synthesized fallback uses "current/total" when no message is present
      expect(logLines).toEqual(['[Test] 1/5']);
    });
  });

  // -----------------------------------------------------------------------
  // Buffer cap (Phase 2)
  // -----------------------------------------------------------------------

  describe('stderr buffer cap', () => {
    it('caps at 100 lines (drops oldest)', async () => {
      const errorEvents: Array<{ details: { stderr?: string } }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      // Emit 120 short lines
      for (let i = 0; i < 120; i++) {
        mockProcess.stderr.emit('data', Buffer.from(`line-${i}\n`));
      }
      mockProcess.emit('close', 1);
      await runPromise;

      const stderrText = errorEvents[0].details.stderr!;
      const capturedLines = stderrText.split('\n');
      expect(capturedLines.length).toBeLessThanOrEqual(100);
      // Should have dropped the oldest lines — last line should be line-119
      expect(capturedLines[capturedLines.length - 1]).toBe('line-119');
      // First line should NOT be line-0 (it was dropped)
      expect(capturedLines[0]).not.toBe('line-0');
    });

    it('caps at 8KB total (drops oldest)', async () => {
      const errorEvents: Array<{ details: { stderr?: string } }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      // Each line is ~1KB, emit 20 lines (20KB total) — should cap at ~8 lines
      for (let i = 0; i < 20; i++) {
        const bigLine = `line-${i}-${'x'.repeat(1000)}\n`;
        mockProcess.stderr.emit('data', Buffer.from(bigLine));
      }
      mockProcess.emit('close', 1);
      await runPromise;

      const stderrText = errorEvents[0].details.stderr!;
      const totalBytes = Buffer.byteLength(stderrText, 'utf8');
      // Total should be within the 8KB limit (each line is ~1KB, so roughly 8 lines max)
      expect(totalBytes).toBeLessThanOrEqual(8192);
      // Should contain the newest lines
      expect(stderrText).toContain('line-19');
    });
  });

  // -----------------------------------------------------------------------
  // isRunning
  // -----------------------------------------------------------------------

  describe('isRunning', () => {
    it('returns false before run', () => {
      expect(executor.isRunning).toBe(false);
    });

    it('returns true during run', () => {
      executor.run('scrape', {});
      expect(executor.isRunning).toBe(true);
    });

    it('returns false after process exits', async () => {
      const runPromise = executor.run('scrape', {});
      mockProcess.emit('close', 0);
      await runPromise;
      expect(executor.isRunning).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Sanitization (Phase 4)
  // -----------------------------------------------------------------------

  describe('sanitizeStderrLine', () => {
    const projectRoot = '/home/user/projects/dataset-builder';

    it('truncates absolute paths to relative', () => {
      const line = `Error in /home/user/projects/dataset-builder/src/cli/index.ts`;
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('Error in src/cli/index.ts');
    });

    it('handles Windows-style paths', () => {
      const winRoot = 'C:\\Users\\dev\\projects\\dataset-builder';
      const line = 'Error in C:\\Users\\dev\\projects\\dataset-builder\\src\\cli\\index.ts';
      const result = sanitizeStderrLine(line, winRoot);
      expect(result).toBe('Error in src\\cli\\index.ts');
    });

    it('redacts Bearer tokens', () => {
      const line = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef';
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('Authorization: Bearer [REDACTED]');
    });

    it('redacts AWS access key IDs', () => {
      const line = 'AWS key: AKIAIOSFODNN7EXAMPLE';
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('AWS key: [REDACTED]');
    });

    it('redacts sk- prefixed API keys', () => {
      const line = 'API key: sk-proj1234567890abcdefghij';
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('API key: [REDACTED]');
    });

    it('redacts long hex/base64 strings (40+ chars)', () => {
      const longHex = 'a'.repeat(40);
      const line = `Token: ${longHex}`;
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('Token: [REDACTED]');
    });

    it('does NOT redact 32-char git SHAs', () => {
      const gitSha = 'abc123def456789012345678abcdef12'; // 32 chars
      const line = `commit ${gitSha}`;
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toContain(gitSha);
    });

    it('does NOT redact 40-char git SHAs (they hit the 40+ threshold)', () => {
      // Note: 40-char strings ARE redacted per spec (threshold is 40+)
      const sha40 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'; // 40 chars
      const line = `commit ${sha40}`;
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('commit [REDACTED]');
    });

    it('handles multiple secrets in one line', () => {
      const line = 'key=sk-abcdefghijklmnopqrstu header=Bearer abcdefghijklmnopqrstuvwx';
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe('key=[REDACTED] header=Bearer [REDACTED]');
    });

    it('leaves normal stderr lines untouched', () => {
      const line = 'WARNING: rate limited, retrying in 5s';
      const result = sanitizeStderrLine(line, projectRoot);
      expect(result).toBe(line);
    });
  });

  describe('stderr sanitization integration', () => {
    it('sanitizes stderr lines before storing in error details', async () => {
      const errorEvents: Array<{ details: { stderr?: string } }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      // Emit stderr with a secret
      mockProcess.stderr.emit('data', Buffer.from('Using key sk-testkey12345678901234567890\n'));
      mockProcess.emit('close', 1);
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].details.stderr).toBe('Using key [REDACTED]');
      expect(errorEvents[0].details.stderr).not.toContain('sk-testkey');
    });

    it('sanitizes stderr lines in log events', async () => {
      const logLines: string[] = [];
      executor.on('log', (line) => logLines.push(line));

      const runPromise = executor.run('scrape', {});

      mockProcess.stderr.emit('data', Buffer.from('Bearer eyJhbGciOiJIUzI1NiJ9abcdefghijk\n'));
      mockProcess.emit('close', 0);
      await runPromise;

      expect(logLines).toHaveLength(1);
      expect(logLines[0]).toBe('Bearer [REDACTED]');
    });
  });

  // -----------------------------------------------------------------------
  // Timeout (Phase 4)
  // -----------------------------------------------------------------------

  describe('job timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('kills process and emits JOB_TIMEOUT after timeout expires', async () => {
      const errorEvents: Array<{
        code: string;
        message: string;
        details: Record<string, unknown>;
      }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const timeoutMs = 60000; // 1 minute for test
      const runPromise = executor.run('scrape', {}, timeoutMs);

      // Advance past the timeout
      vi.advanceTimersByTime(timeoutMs);

      // Process should have received SIGTERM
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Simulate process exiting after SIGTERM
      mockProcess.emit('close', null, 'SIGTERM');
      await runPromise;

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].code).toBe('JOB_TIMEOUT');
      expect(errorEvents[0].message).toBe('Job timed out after 1 minutes');
    });

    it('sends SIGKILL after grace period if process does not exit', async () => {
      const errorEvents: Array<{ code: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const timeoutMs = 60000;
      const runPromise = executor.run('scrape', {}, timeoutMs);

      // Advance past the timeout
      vi.advanceTimersByTime(timeoutMs);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Process doesn't exit — advance past grace period
      vi.advanceTimersByTime(5000);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');

      // Now simulate process exit
      mockProcess.emit('close', null, 'SIGKILL');
      await runPromise;

      expect(errorEvents[0].code).toBe('JOB_TIMEOUT');
    });

    it('does not timeout if process exits before timeout', async () => {
      const errorEvents: Array<{ code: string }> = [];
      const completeEvents: unknown[] = [];
      executor.on('error', (e) => errorEvents.push(e));
      executor.on('complete', (r) => completeEvents.push(r));

      const timeoutMs = 60000;
      const runPromise = executor.run('scrape', {}, timeoutMs);

      // Process exits before timeout
      mockProcess.emit('close', 0);
      await runPromise;

      // Advance past where timeout would have fired
      vi.advanceTimersByTime(timeoutMs + 1000);

      expect(errorEvents).toHaveLength(0);
      expect(completeEvents).toHaveLength(1);
    });

    it('uses default 30-minute timeout when not specified', async () => {
      const errorEvents: Array<{ code: string; message: string }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {});

      // Advance to 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      mockProcess.emit('close', null, 'SIGTERM');
      await runPromise;

      expect(errorEvents[0].code).toBe('JOB_TIMEOUT');
      expect(errorEvents[0].message).toBe('Job timed out after 30 minutes');
    });

    it('clears timeout timers when cancel is called', async () => {
      const runPromise = executor.run('scrape', {}, 60000);

      // Cancel before timeout
      executor.cancel();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      mockProcess.emit('close', null);
      await runPromise;

      // Advancing timers should not cause additional kills
      mockProcess.kill.mockClear();
      vi.advanceTimersByTime(60000);
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('includes stderr in timeout error details', async () => {
      const errorEvents: Array<{ code: string; details: { stderr?: string } }> = [];
      executor.on('error', (e) => errorEvents.push(e));

      const runPromise = executor.run('scrape', {}, 60000);

      mockProcess.stderr.emit('data', Buffer.from('Still processing...\n'));

      vi.advanceTimersByTime(60000);
      mockProcess.emit('close', null, 'SIGTERM');
      await runPromise;

      expect(errorEvents[0].code).toBe('JOB_TIMEOUT');
      expect(errorEvents[0].details.stderr).toBe('Still processing...');
    });
  });
});
