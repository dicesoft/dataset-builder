/**
 * Output abstraction layer for agent-friendly CLI
 * Provides structured JSON output mode and global flag management
 */

import { maskSensitiveFields } from './sanitize';

export interface GlobalFlags {
  json: boolean;
  quiet: boolean;
  yes: boolean;
  verbose: boolean;
  dryRun: boolean;
}

export interface JsonEnvelope {
  version: 1;
  success: boolean;
  command: string;
  data: unknown;
  stats?: Record<string, unknown>;
}

export interface JsonErrorEnvelope {
  version: 1;
  error: true;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** NDJSON log event emitted to stderr in JSON mode */
export interface LogEvent {
  type: 'log';
  level: 'debug' | 'info' | 'success' | 'warn' | 'error' | 'verbose';
  message: string;
  timestamp: string;
}

/** NDJSON progress event emitted to stderr in JSON mode */
export interface ProgressEvent {
  type: 'progress';
  phase: string;
  current: number;
  total?: number;
  message?: string;
  counters?: Record<string, number>;
  timestamp: string;
}

/** NDJSON completion event emitted to stderr in JSON mode */
export interface CompletionEvent {
  type: 'complete';
  phase: string;
  duration_ms: number;
  summary?: string;
  timestamp: string;
}

/** Union of all NDJSON event types emitted to stderr in JSON mode */
export type StderrEvent = LogEvent | ProgressEvent | CompletionEvent;

/** Full JSON protocol: stdout envelope + stderr events */
export interface CLIProtocol {
  stdout: JsonEnvelope | JsonErrorEnvelope;
  stderr: StderrEvent[];
}

let flags: GlobalFlags = { json: false, quiet: false, yes: false, verbose: false, dryRun: false };

export function setGlobalFlags(f: GlobalFlags): void {
  flags = { ...f };
  // --json implies --yes to prevent agents from hanging on confirmation prompts
  if (flags.json) {
    flags.yes = true;
  }
}

export function getGlobalFlags(): GlobalFlags {
  return flags;
}

export function isJsonMode(): boolean {
  return (
    flags.json || process.env.JSON_OUTPUT === 'true' || process.env.DATASET_BUILDER_JSON === '1'
  );
}

export function isQuietMode(): boolean {
  return flags.quiet || process.env.QUIET === 'true' || process.env.DATASET_BUILDER_QUIET === '1';
}

export function isYesMode(): boolean {
  return flags.yes || process.env.YES === 'true' || process.env.CI === 'true';
}

/**
 * Output the final structured result of a command.
 * In JSON mode: prints JSON envelope to stdout.
 * In normal mode: no-op (commands print their own human output).
 */
export function outputResult(
  command: string,
  data: unknown,
  stats?: Record<string, unknown>
): void {
  if (isJsonMode()) {
    // Mask sensitive fields in object data before serialization
    const maskedData =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? maskSensitiveFields(data as Record<string, unknown>)
        : data;
    const envelope: JsonEnvelope = { version: 1, success: true, command, data: maskedData };
    if (stats) {
      envelope.stats = stats;
    }
    try {
      process.stdout.write(JSON.stringify(envelope) + '\n');
    } catch (err) {
      // Circular reference or other serialization error — fallback with safe serializer
      const seen = new WeakSet();
      const safeEnvelope = JSON.stringify(envelope, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      });
      process.stdout.write(safeEnvelope + '\n');
    }
  }
}

/**
 * Output a structured error.
 * In JSON mode: prints error JSON to stdout.
 * In normal mode: no-op (callers handle human-readable output).
 */
export function outputError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  if (isJsonMode()) {
    const envelope: JsonErrorEnvelope = { version: 1, error: true, code, message };
    if (details) {
      envelope.details = details;
    }
    process.stdout.write(JSON.stringify(envelope) + '\n');
  }
}
