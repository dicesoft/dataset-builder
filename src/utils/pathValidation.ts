/**
 * Path boundary validation utilities
 * Prevents path traversal attacks by ensuring paths stay within allowed roots
 */

import path from 'path';
import { CLIError, ErrorCodes } from './errorCodes';
import { ExitCode } from './exitCodes';

/**
 * Resolves a file path and throws CLIError(INVALID_INPUT) if the resolved path
 * escapes the allowed root directory.
 * Returns the resolved absolute path on success.
 */
export function validatePathBoundary(filePath: string, allowedRoot: string): string {
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(allowedRoot);

  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      `Path "${filePath}" escapes allowed root directory "${allowedRoot}"`,
      ExitCode.INVALID_INPUT
    );
  }

  return resolvedPath;
}
