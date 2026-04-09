/**
 * Safe JSON parsing utilities with contextual error messages
 * Wraps JSON.parse with try/catch, throws CLIError(INVALID_INPUT) with source context on failure
 */

import { CLIError, ErrorCodes } from './errorCodes';
import { ExitCode } from './exitCodes';

/**
 * Safely parse a JSON string, throwing CLIError with source context on failure
 */
export function safeJsonParse(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      `Invalid JSON in ${source}: failed to parse content`,
      ExitCode.INVALID_INPUT
    );
  }
}

/**
 * Safely parse a JSONL (newline-delimited JSON) string, throwing CLIError with source context on failure.
 * Returns an array of parsed objects, one per non-empty line.
 */
export function safeJsonlParse(raw: string, source: string): unknown[] {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const results: unknown[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      results.push(JSON.parse(lines[i]));
    } catch {
      throw new CLIError(
        ErrorCodes.INVALID_INPUT,
        `Invalid JSON in ${source} at line ${i + 1}: failed to parse content`,
        ExitCode.INVALID_INPUT
      );
    }
  }

  return results;
}
