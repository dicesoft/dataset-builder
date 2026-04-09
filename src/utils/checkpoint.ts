/**
 * Generic checkpoint utilities for resumable CLI operations.
 *
 * Reuses the same file-naming convention as the transform checkpoint
 * (hidden dot-prefixed JSON beside the output file) but works with
 * any command that processes records sequentially.
 */

import fs from 'fs/promises';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Base checkpoint shape shared by generate, translate, and clean commands */
export interface CommandCheckpoint {
  /** Which command created this checkpoint */
  command: 'generate' | 'translate' | 'clean';
  /** Absolute path to the output file / directory */
  outputPath: string;
  /** Total records expected */
  totalRecords: number;
  /** Indices (or IDs) of records that have been completed */
  completedIndices: number[];
  /** Partial results collected so far (JSON-serialisable) */
  partialResults: unknown[];
  /** ISO timestamp when the run started */
  startedAt: string;
  /** ISO timestamp of last save */
  lastUpdatedAt: string;
  /** Arbitrary command-specific metadata */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive the checkpoint file path from an output path */
export function getCheckpointPath(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, path.extname(outputPath));
  return path.join(dir, `.${base}.checkpoint.json`);
}

/** Save a checkpoint atomically */
export async function saveCommandCheckpoint(cp: CommandCheckpoint): Promise<void> {
  cp.lastUpdatedAt = new Date().toISOString();
  const cpPath = getCheckpointPath(cp.outputPath);
  await fs.mkdir(path.dirname(cpPath), { recursive: true });
  await fs.writeFile(cpPath, JSON.stringify(cp, null, 2), 'utf-8');
}

/** Load a checkpoint from disk (returns null when none exists) */
export async function loadCommandCheckpoint(
  checkpointFile: string
): Promise<CommandCheckpoint | null> {
  try {
    const data = await fs.readFile(checkpointFile, 'utf-8');
    return JSON.parse(data) as CommandCheckpoint;
  } catch {
    return null;
  }
}

/** Delete a checkpoint file (no-op if it doesn't exist) */
export async function clearCommandCheckpoint(outputPath: string): Promise<void> {
  const cpPath = getCheckpointPath(outputPath);
  try {
    await fs.unlink(cpPath);
  } catch {
    // ignore
  }
}
