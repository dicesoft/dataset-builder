/**
 * Typed exit codes for the CLI
 * Replaces all process.exit(1) with semantically meaningful codes
 */

import { outputError, isJsonMode } from './output';

export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  INVALID_INPUT = 2,
  MISSING_DEPENDENCY = 3,
  NETWORK_ERROR = 4,
  OLLAMA_UNAVAILABLE = 5,
  PARTIAL_SUCCESS = 6,
  USER_ABORT = 7,
}

/**
 * Exit the process with a typed exit code.
 * In JSON mode, outputs the error as structured JSON before exiting.
 */
export function exitWithCode(code: ExitCode, message?: string): never {
  if (message && isJsonMode()) {
    const errorCode = ExitCode[code] || 'GENERAL_ERROR';
    outputError(errorCode, message);
  }
  process.exit(code);
}
