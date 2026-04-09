/**
 * Structured error codes and CLIError class
 * Provides typed error handling for all CLI commands
 */

import { ExitCode } from './exitCodes';

export const ErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_DEPENDENCY: 'MISSING_DEPENDENCY',
  NETWORK_ERROR: 'NETWORK_ERROR',
  OLLAMA_UNAVAILABLE: 'OLLAMA_UNAVAILABLE',
  TRANSFORM_ERROR: 'TRANSFORM_ERROR',
  FORMAT_ERROR: 'FORMAT_ERROR',
  PIPELINE_ERROR: 'PIPELINE_ERROR',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  GENERAL_ERROR: 'GENERAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class CLIError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly exitCode: ExitCode = ExitCode.GENERAL_ERROR,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CLIError';
  }
}
