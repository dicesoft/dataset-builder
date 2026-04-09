/**
 * Shared path utilities for the web dashboard server.
 */

import path from 'path';

/**
 * Verify that a resolved path is within the allowed base directory.
 * Prevents path traversal attacks.
 */
export function isWithinDir(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  return resolved.startsWith(base + path.sep) || resolved === base;
}
