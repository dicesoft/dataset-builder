/**
 * Shared audio utilities for audio dataset formatters
 * Audio validation, path resolution, metadata extraction
 */

import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { copyFile as baseCopyFile, fileExists } from '../utils';

const execFileAsync = promisify(execFile);

/**
 * Default allowed audio extensions
 */
export const DEFAULT_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.wma', '.aac'];

/**
 * Resolve an audio path relative to a base directory
 * Returns absolute path
 */
export function resolveAudioPath(audioPath: string, basePath?: string): string {
  if (path.isAbsolute(audioPath)) return audioPath;
  return path.resolve(basePath || process.cwd(), audioPath);
}

/**
 * Validate an audio file exists and has an allowed extension
 * Extension-based + fs.access only
 */
export async function validateAudio(
  audioPath: string,
  allowedExts: string[] = DEFAULT_AUDIO_EXTENSIONS
): Promise<{ valid: boolean; error?: string }> {
  const ext = path.extname(audioPath).toLowerCase();
  if (!allowedExts.includes(ext)) {
    return { valid: false, error: `Unsupported audio extension: ${ext}` };
  }

  const exists = await fileExists(audioPath);
  if (!exists) {
    return { valid: false, error: `Audio file not found: ${audioPath}` };
  }

  return { valid: true };
}

/**
 * Copy an audio file to a destination
 * Thin wrapper over base copyFile
 */
export async function copyAudio(src: string, dest: string): Promise<void> {
  await baseCopyFile(src, dest);
}

/**
 * Audio metadata from ffprobe
 */
export interface AudioMetadata {
  duration?: number;
  sampleRate?: number;
}

/**
 * Extract audio metadata (duration, sample rate) via ffprobe
 * Returns partial metadata — gracefully returns empty object if ffprobe is unavailable
 */
export async function getAudioMetadata(audioPath: string): Promise<AudioMetadata> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-select_streams',
      'a:0',
      audioPath,
    ]);

    const info = JSON.parse(stdout);
    const stream = info.streams?.[0];
    if (!stream) return {};

    const metadata: AudioMetadata = {};
    if (stream.duration) {
      metadata.duration = parseFloat(stream.duration);
    }
    if (stream.sample_rate) {
      metadata.sampleRate = parseInt(stream.sample_rate, 10);
    }
    return metadata;
  } catch {
    // ffprobe not available or failed — graceful fallback
    return {};
  }
}

/**
 * Get a portable relative audio path from outputDir
 * Always uses forward slashes for cross-platform compatibility
 */
export function getRelativeAudioPath(audioPath: string, outputDir: string): string {
  const rel = path.relative(outputDir, audioPath);
  return rel.replace(/\\/g, '/');
}

/**
 * Batch validate audio files in a dataset
 * Returns indices of valid records and error messages for invalid ones
 */
export async function batchValidateAudio(
  data: unknown[],
  audioField: string,
  basePath?: string,
  allowedExts: string[] = DEFAULT_AUDIO_EXTENSIONS
): Promise<{ validIndices: number[]; errors: Array<{ index: number; error: string }> }> {
  const validIndices: number[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    const audioPath = record[audioField] as string | undefined;

    if (!audioPath) {
      errors.push({ index: i, error: `Missing audio field "${audioField}"` });
      continue;
    }

    const fullPath = resolveAudioPath(String(audioPath), basePath);
    const result = await validateAudio(fullPath, allowedExts);

    if (result.valid) {
      validIndices.push(i);
    } else {
      errors.push({ index: i, error: result.error || 'Unknown validation error' });
    }
  }

  return { validIndices, errors };
}
