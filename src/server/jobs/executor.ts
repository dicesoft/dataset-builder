/**
 * T014: Job executor
 * Spawns CLI commands as child processes, parses NDJSON progress from stderr,
 * captures stdout for final result, supports cancellation.
 *
 * -----------------------------------------------------------------------
 * Path normalization contract (master-plan.md §3.4)
 * -----------------------------------------------------------------------
 * Values supplied by the dashboard for options listed in
 * {@link PATH_INPUT_OPTIONS} are treated as **potentially relative paths
 * rooted at `config.outputDir`**. This is because the `GET /api/v1/datasets`
 * endpoint emits paths relative to `outputDir` (see `datasets.ts:394`), and
 * the spawned CLI child process runs with `cwd = projectRoot` — so a raw
 * relative path would resolve against the wrong base and produce ENOENT.
 *
 * Invariant: before any argument that belongs to `PATH_INPUT_OPTIONS` is
 * pushed onto the child-process argv, this module:
 *   1. Passes it through {@link resolveRelativeInputPath}, which
 *      absolutizes it against `config.outputDir` (stripping any legacy
 *      leading `<outputDir-basename>/` segment);
 *   2. Asserts via {@link isWithinDir} that the resolved path is contained
 *      within `outputDir` — rejecting traversal attempts with a
 *      `PATH_TRAVERSAL` error and refusing to spawn the child; and
 *   3. Refuses to silently fall back to the unresolved value if config
 *      is unavailable — propagating `JOB_CONFIG_UNAVAILABLE` instead.
 *
 * The audit that decided `PATH_INPUT_OPTIONS` is a single global set (rather
 * than per-command) lives in
 * `docs/plans/transform-e2e-verification/path-option-audit.md`. If a future
 * path-like option must NOT be resolved against `outputDir`, that audit
 * must be revisited and the set converted to a
 * `Record<command, Set<optionName>>` map.
 */

import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import { JobProgress, JobError, JobErrorDetails } from './types';
import { getConfig } from '../../config';
import { isWithinDir } from '../utils/paths';

/**
 * Options whose values are file-system paths that the dashboard sends
 * relative to the configured outputDir (since that's what the datasets API
 * returns). Before spawning the CLI child process we resolve these against
 * outputDir so relative paths don't get resolved against the CLI's cwd
 * (the project root) — which would produce ENOENT errors.
 */
const PATH_INPUT_OPTIONS = new Set(['input']);

/**
 * Typed error thrown by {@link resolveRelativeInputPath} when input fails
 * validation or containment checks. The `code` property lets the JobManager
 * surface it as a JobError without spawning the CLI child process.
 */
export class PathResolutionError extends Error {
  public readonly code: 'PATH_TRAVERSAL' | 'INVALID_INPUT_PATH' | 'JOB_CONFIG_UNAVAILABLE';
  constructor(
    code: 'PATH_TRAVERSAL' | 'INVALID_INPUT_PATH' | 'JOB_CONFIG_UNAVAILABLE',
    message: string
  ) {
    super(message);
    this.name = 'PathResolutionError';
    this.code = code;
  }
}

/**
 * Resolve a relative path-like option value against outputDir.
 * - Empty string passthrough (the run loop skips resolution for blank values).
 * - Whitespace-only → `INVALID_INPUT_PATH`.
 * - Absolute paths are returned unchanged **after** a containment check.
 * - Relative paths are stripped of a single leading `<outputDir-basename>/`
 *   segment (for legacy persisted job records, mirroring
 *   `datasets.ts:507-513`) then resolved against the configured outputDir.
 * - In both branches the final resolved path must be contained within
 *   outputDir; otherwise a `PATH_TRAVERSAL` error is thrown.
 * - If `getConfig()` throws, `JOB_CONFIG_UNAVAILABLE` propagates — there is
 *   no silent fallback to the unresolved value (that would re-introduce the
 *   original ENOENT bug as an intermittent).
 */
export function resolveRelativeInputPath(value: string): string {
  if (value === '') return value;
  if (value.trim() === '') {
    throw new PathResolutionError('INVALID_INPUT_PATH', 'Input path must not be whitespace-only');
  }

  let outputDir: string;
  try {
    outputDir = path.resolve(getConfig().get('outputDir') as string);
  } catch (err) {
    throw new PathResolutionError(
      'JOB_CONFIG_UNAVAILABLE',
      `Unable to resolve outputDir from config: ${(err as Error).message}`
    );
  }

  let resolved: string;
  if (path.isAbsolute(value)) {
    resolved = value;
  } else {
    // Strip a single leading `<outputDir-basename>/` segment so legacy
    // persisted job records (e.g. `output/task_x/foo.json`) resolve to
    // `<outputDir>/task_x/foo.json` instead of `<outputDir>/output/...`.
    // Matches the normalization in `datasets.ts:507-513`. Using the basename
    // of outputDir (rather than a hardcoded "output/") keeps this correct
    // when users configure a non-default output directory.
    const outputDirBase = path.basename(outputDir);
    const normalized = value.replace(/\\/g, '/');
    const stripped = normalized.startsWith(`${outputDirBase}/`)
      ? normalized.slice(outputDirBase.length + 1)
      : value;
    resolved = path.resolve(outputDir, stripped);
  }

  if (!isWithinDir(resolved, outputDir)) {
    throw new PathResolutionError(
      'PATH_TRAVERSAL',
      `Input path resolves outside of outputDir: ${value}`
    );
  }

  return resolved;
}

/** Maximum number of stderr lines to retain */
const STDERR_MAX_LINES = 100;
/** Maximum total bytes of stderr to retain */
const STDERR_MAX_BYTES = 8192;
/** Default job wall-clock timeout in milliseconds (30 minutes) */
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
/** Grace period before SIGKILL after SIGTERM on timeout (ms) */
const TIMEOUT_KILL_GRACE_MS = 5000;

/**
 * Secret-redaction patterns applied to stderr lines before storage.
 * Order matters: more specific patterns first to avoid partial matches.
 */
const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // AWS access key IDs
  { regex: /AKIA[A-Z0-9]{16}/g, replacement: '[REDACTED]' },
  // Bearer tokens
  { regex: /Bearer [A-Za-z0-9_-]{20,}/g, replacement: 'Bearer [REDACTED]' },
  // sk- prefixed API keys (OpenAI, Stripe, etc.)
  { regex: /sk-[A-Za-z0-9]{20,}/g, replacement: '[REDACTED]' },
  // Long hex/base64 strings (40+ chars) — NOT git SHAs (32-40 chars)
  { regex: /[A-Za-z0-9]{40,}/g, replacement: '[REDACTED]' },
];

/**
 * Sanitize a stderr line before storage:
 * 1. Strip absolute paths to relative (remove everything up to project root)
 * 2. Redact potential secrets
 */
export function sanitizeStderrLine(line: string, projectRoot: string): string {
  let sanitized = line;

  // Normalize project root for both forward and back slashes
  const normalizedRoot = projectRoot.replace(/\\/g, '/');
  // Escape for regex
  const escapedRoot = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the project root with either slash style, with trailing slash
  const pathRegex = new RegExp(escapedRoot.replace(/\//g, '[/\\\\]') + '[/\\\\]?', 'gi');
  sanitized = sanitized.replace(pathRegex, '');

  // Also handle the original (non-normalized) form for Windows paths
  if (projectRoot !== normalizedRoot) {
    const escapedOriginal = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const winPathRegex = new RegExp(escapedOriginal + '[/\\\\]?', 'gi');
    sanitized = sanitized.replace(winPathRegex, '');
  }

  // Redact secrets
  for (const { regex, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }

  return sanitized;
}

export interface ExecutorEvents {
  progress: (progress: JobProgress) => void;
  complete: (result: unknown) => void;
  error: (error: JobError) => void;
  log: (line: string) => void;
}

export class JobExecutor extends EventEmitter {
  private process: ChildProcess | null = null;
  private killed = false;
  private timedOut = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutKillTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Spawn a CLI command as a child process
   * @param command - CLI command name (e.g., 'scrape', 'generate')
   * @param options - Command options as key-value pairs
   * @param timeoutMs - Wall-clock timeout in ms (default: 30 minutes)
   * @returns Promise that resolves when the process exits
   */
  async run(
    command: string,
    options: Record<string, unknown>,
    timeoutMs: number = DEFAULT_JOB_TIMEOUT_MS
  ): Promise<void> {
    const cliPath = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');

    // Build argument list
    const args = [cliPath, '--json', '--yes', command];

    try {
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined || value === null) continue;

        // Skip json and yes — already hardcoded as global options above
        if (key === 'json' || key === 'yes') continue;

        // Convert camelCase to kebab-case for CLI flags
        const flag = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;

        if (typeof value === 'boolean') {
          if (value) args.push(flag);
        } else if (Array.isArray(value)) {
          // Pass array values as comma-separated
          args.push(flag, value.join(','));
        } else {
          let strValue = String(value);
          // Resolve path-like options against outputDir so relative paths
          // returned from the datasets API (e.g. "task_xxx/foo.json") resolve
          // correctly in the CLI child process, which runs with cwd at the
          // project root rather than inside outputDir.
          if (PATH_INPUT_OPTIONS.has(key) && strValue.length > 0) {
            strValue = resolveRelativeInputPath(strValue);
          }
          args.push(flag, strValue);
        }
      }
    } catch (err) {
      // Path resolution / containment / config failures: emit as a JobError
      // and do NOT spawn the child process.
      if (err instanceof PathResolutionError) {
        this.emit('error', {
          code: err.code,
          message: err.message,
          details: null,
        } as JobError);
        return;
      }
      throw err;
    }

    return new Promise<void>((resolve) => {
      this.process = spawn('node', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: { ...process.env },
      });

      const projectRoot = process.cwd();
      let stdoutBuffer = '';
      let stderrBuffer = '';
      const stderrLines: string[] = [];
      let stderrTotalBytes = 0;
      let lastSynthLogLine = ''; // dedupe consecutive identical synth log lines

      // Capture stdout for final result
      this.process.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
      });

      // Parse stderr for NDJSON progress events, capture non-JSON lines
      this.process.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();

        // Process complete lines
        const lines = stderrBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        stderrBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed);
            if (event.type === 'progress') {
              const progress: JobProgress = {
                phase: event.phase || '',
                current: event.current || 0,
                total: event.total ?? null,
                counters: event.counters ?? null,
                message: event.message ?? null,
                throughput: event.throughput ?? null,
              };
              this.emit('progress', progress);

              // Also synthesize a log line so the live logs panel shows activity.
              // In --json mode the CLI emits NDJSON only, so without this the log
              // pipeline never receives anything until something fails.
              const phase = event.phase ? `[${event.phase}] ` : '';
              const detail =
                event.message ||
                (event.total != null && event.current != null
                  ? `${event.current}/${event.total}`
                  : null);
              if (detail) {
                const synthLine = `${phase}${detail}`;
                if (synthLine !== lastSynthLogLine) {
                  lastSynthLogLine = synthLine;
                  this.emit('log', synthLine);
                }
              }
            } else if (event.type === 'log' && typeof event.message === 'string') {
              // Forward explicit log events from the CLI (future-proofing)
              this.emit('log', event.message);
            }
            // Other stderr events (complete, etc.) are informational
          } catch {
            // Not JSON — sanitize and capture as stderr line
            const sanitized = sanitizeStderrLine(trimmed, projectRoot);
            const lineBytes = Buffer.byteLength(sanitized, 'utf8');

            // Ring buffer: drop oldest when either limit is exceeded
            while (
              stderrLines.length > 0 &&
              (stderrLines.length >= STDERR_MAX_LINES ||
                stderrTotalBytes + lineBytes > STDERR_MAX_BYTES)
            ) {
              const dropped = stderrLines.shift()!;
              stderrTotalBytes -= Buffer.byteLength(dropped, 'utf8');
            }

            stderrLines.push(sanitized);
            stderrTotalBytes += lineBytes;
            this.emit('log', sanitized);
          }
        }
      });

      // Wall-clock timeout
      this.timedOut = false;
      this.timeoutTimer = setTimeout(() => {
        if (this.process && !this.killed) {
          this.timedOut = true;
          this.process.kill('SIGTERM');

          // Force kill after grace period
          this.timeoutKillTimer = setTimeout(() => {
            if (this.process) {
              this.process.kill('SIGKILL');
            }
          }, TIMEOUT_KILL_GRACE_MS);
        }
      }, timeoutMs);

      this.process.on('close', (code, signal) => {
        this.process = null;

        // Clear timeout timers
        if (this.timeoutTimer) {
          clearTimeout(this.timeoutTimer);
          this.timeoutTimer = null;
        }
        if (this.timeoutKillTimer) {
          clearTimeout(this.timeoutKillTimer);
          this.timeoutKillTimer = null;
        }

        if (this.timedOut) {
          // Process was killed due to timeout
          const minutes = Math.round(timeoutMs / 60000);
          const details: JobErrorDetails = {
            exitCode: code,
            signal: signal || undefined,
            stderr: stderrLines.length > 0 ? stderrLines.join('\n') : undefined,
          };
          this.emit('error', {
            code: 'JOB_TIMEOUT',
            message: `Job timed out after ${minutes} minutes`,
            details,
          } as JobError);
          resolve();
          return;
        }

        if (this.killed) {
          // Process was intentionally killed (cancel)
          resolve();
          return;
        }

        if (code === 0) {
          // Parse stdout for the final JSON result.
          //
          // CLI commands emit a JSON envelope (`{version, success, command, data}`)
          // via `outputResult()` in JSON mode, but some commands still call raw
          // `console.log(chalk...)` for progress/stats without guarding on
          // `isJsonMode()`. That leaks plaintext into stdout before the envelope,
          // so we cannot `JSON.parse(entireBuffer)`. Instead, scan stdout lines
          // from the end and use the last line that parses as a JSON object with
          // the expected envelope shape.
          let result: unknown = null;
          let envelope: {
            success?: boolean;
            data?: unknown;
            error?: unknown;
            code?: string;
            message?: string;
            details?: unknown;
          } | null = null;
          const trimmedStdout = stdoutBuffer.trim();
          if (trimmedStdout) {
            const lines = trimmedStdout.split(/\r?\n/);
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (!line.startsWith('{')) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  envelope = parsed;
                  break;
                }
              } catch {
                // not valid JSON, keep scanning
              }
            }
            if (envelope) {
              if (envelope.success) {
                result = envelope.data;
              } else if (envelope.error) {
                this.emit('error', {
                  code: envelope.code || 'CLI_ERROR',
                  message: envelope.message || 'CLI returned an error',
                  details: envelope.details || null,
                } as JobError);
                resolve();
                return;
              }
            } else {
              // No JSON envelope in stdout — keep the raw text as a fallback so
              // the dashboard can still surface something instead of silently
              // dropping the output.
              result = trimmedStdout;
            }
          }
          this.emit('complete', result);
        } else {
          // Non-zero exit code
          let errorMessage = signal
            ? `Process killed by ${signal}`
            : `Process exited with code ${code}`;
          let errorCode = 'CLI_EXIT_ERROR';
          let stdoutHadEnvelope = false;

          // Try to parse error from stdout
          const trimmedStdout = stdoutBuffer.trim();
          if (trimmedStdout) {
            try {
              const envelope = JSON.parse(trimmedStdout);
              if (envelope.error || envelope.code) {
                errorCode = envelope.code || errorCode;
                errorMessage = envelope.message || errorMessage;
                stdoutHadEnvelope = true;
              }
            } catch {
              // Not JSON
            }
          }

          // If stdout had no JSON error envelope, try to extract message from stderr
          if (!stdoutHadEnvelope && stderrLines.length > 0) {
            const extracted = extractStderrMessage(stderrLines);
            if (extracted) {
              errorMessage = extracted;
            }
          }

          const details: JobErrorDetails = {
            exitCode: code,
            signal: signal || undefined,
            stderr: stderrLines.length > 0 ? stderrLines.join('\n') : undefined,
          };

          this.emit('error', {
            code: errorCode,
            message: errorMessage,
            details,
          } as JobError);
        }

        resolve();
      });

      this.process.on('error', (err) => {
        this.process = null;
        this.emit('error', {
          code: 'SPAWN_ERROR',
          message: err.message,
          details: null,
        } as JobError);
        resolve();
      });
    });
  }

  /**
   * Cancel the running process
   */
  cancel(): void {
    if (this.process && !this.killed) {
      this.killed = true;

      // Clear job timeout timers
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = null;
      }
      if (this.timeoutKillTimer) {
        clearTimeout(this.timeoutKillTimer);
        this.timeoutKillTimer = null;
      }

      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if still alive
      const forceKillTimeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process.on('close', () => {
        clearTimeout(forceKillTimeout);
      });
    }
  }

  /**
   * Check if the executor is currently running a process
   */
  get isRunning(): boolean {
    return this.process !== null;
  }
}

/**
 * Extract a meaningful error message from captured stderr lines.
 * Heuristic:
 *  1. Prefer first line matching /^(Error|error|ERROR):/
 *  2. Else last non-empty line not starting with whitespace
 *  3. Else last non-empty line
 */
function extractStderrMessage(lines: string[]): string | null {
  // 1. First line matching Error:/error:/ERROR:
  for (const line of lines) {
    if (/^(Error|error|ERROR):/.test(line)) {
      return line;
    }
  }

  // 2. Last non-empty line not starting with whitespace
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !/^\s/.test(lines[i])) {
      return line;
    }
  }

  // 3. Last non-empty line
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) {
      return line;
    }
  }

  return null;
}
