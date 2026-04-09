/**
 * Shared helper for deriving a "task directory" from an input path.
 *
 * The `transform` and `clean` CLI commands each need to know which directory
 * a piece of input belongs to: if the input is a directory, it IS the task
 * directory; if it's a file, the task directory is its parent. Before this
 * helper existed, each command implemented that stat-then-dirname logic
 * independently, and the copies had started to drift (master-plan.md §3.5).
 *
 * Centralizing the logic here keeps the Phase 3.4 executor-normalization
 * contract honest: the executor absolutizes `--input`, and the CLI commands
 * agree on what "the task directory" means given that absolute path.
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * Derive the task directory from an input path.
 *
 * @param inputPath  absolute or relative filesystem path
 * @returns the directory containing the input — the path itself if it
 *          points at a directory, or its `dirname` if it points at a file
 * @throws  the underlying `fs.stat` error if the path does not exist or
 *          is unreadable. Callers that want a fallback (e.g. "input doesn't
 *          exist yet, create a new task folder") should catch the error
 *          and handle it explicitly rather than having this helper guess.
 */
export async function deriveTaskDirFromInput(inputPath: string): Promise<string> {
  const stat = await fs.stat(inputPath);
  if (stat.isDirectory()) {
    return inputPath;
  }
  return path.dirname(inputPath);
}
