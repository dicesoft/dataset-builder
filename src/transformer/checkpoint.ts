/**
 * Checkpoint utilities for resumable transform operations
 */

import fs from 'fs/promises';
import path from 'path';
import { TransformCheckpoint } from './types';

/**
 * Get the checkpoint file path for a given output path
 */
export function getCheckpointPath(outputPath: string): string {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, path.extname(outputPath));
  return path.join(dir, `.${base}.checkpoint.json`);
}

/**
 * Save checkpoint to disk
 */
export async function saveCheckpoint(checkpoint: TransformCheckpoint): Promise<void> {
  checkpoint.lastUpdatedAt = new Date().toISOString();
  const checkpointPath = getCheckpointPath(checkpoint.outputPath);
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

/**
 * Load checkpoint from disk
 * Returns null if checkpoint doesn't exist
 */
export async function loadCheckpoint(outputPath: string): Promise<TransformCheckpoint | null> {
  const checkpointPath = getCheckpointPath(outputPath);
  try {
    const data = await fs.readFile(checkpointPath, 'utf-8');
    return JSON.parse(data) as TransformCheckpoint;
  } catch {
    return null;
  }
}

/**
 * Clear (delete) checkpoint file
 */
export async function clearCheckpoint(outputPath: string): Promise<void> {
  const checkpointPath = getCheckpointPath(outputPath);
  try {
    await fs.unlink(checkpointPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if checkpoint exists for given output path
 */
export async function hasCheckpoint(outputPath: string): Promise<boolean> {
  const checkpointPath = getCheckpointPath(outputPath);
  try {
    await fs.access(checkpointPath);
    return true;
  } catch {
    return false;
  }
}
