/**
 * AudioFolder formatter
 * Audio classification format: class_a/audio1.wav + metadata.csv
 * Mirrors HuggingFace ImageFolder pattern for audio datasets
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, AudioFolderOptions } from '../types';
import { ensureDir, writeData } from '../utils';
import { resolveAudioPath, copyAudio, DEFAULT_AUDIO_EXTENSIONS } from './utils';

/**
 * AudioFolder metadata record
 */
export interface AudioFolderMetadataRecord {
  file_name: string;
  label: string;
  [key: string]: unknown;
}

/**
 * AudioFolder formatter implementation
 */
export class AudioFolderFormatter implements Formatter<AudioFolderOptions> {
  name = 'audiofolder';
  description = 'AudioFolder format for audio classification (class folders + metadata.csv)';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for AudioFolder format
   * Requires classField and audioField
   */
  validate(input: unknown[], options?: Partial<AudioFolderOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const audioField = options?.audioField || 'audio';
    const classField = options?.classField;

    if (!classField) {
      return {
        valid: false,
        errors: [
          {
            index: -1,
            message: 'AudioFolder format requires --class-field option',
          },
        ],
        stats: { total: input.length, valid: 0, invalid: input.length },
      };
    }

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check audio field
      const audioValue = record[audioField];
      if (!audioValue || typeof audioValue !== 'string') {
        errors.push({
          index: i,
          field: audioField,
          message: `Required field "${audioField}" must be a non-empty string`,
          value: audioValue,
        });
        recordValid = false;
      }

      // Check class field
      const classValue = record[classField];
      if (classValue === undefined || classValue === null || classValue === '') {
        errors.push({
          index: i,
          field: classField,
          message: `Required field "${classField}" is missing or empty`,
          value: classValue,
        });
        recordValid = false;
      }

      if (recordValid) validCount++;
    }

    return {
      valid: errors.length === 0,
      errors,
      stats: {
        total: input.length,
        valid: validCount,
        invalid: input.length - validCount,
      },
    };
  }

  /**
   * Format data to AudioFolder format
   * Creates class_name/ directories with audio files + metadata.csv
   */
  async format(input: unknown[], options: AudioFolderOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const audioField = options.audioField || 'audio';
    const classField = options.classField;
    const allowedExts = options.audioExtensions || DEFAULT_AUDIO_EXTENSIONS;
    const basePath = options.basePath;

    const metadataRecords: AudioFolderMetadataRecord[] = [];
    const outputFiles: string[] = [];
    let skipped = 0;

    // Track filename collisions per class
    const filenameCounts = new Map<string, number>();

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const audioPath = String(record[audioField] || '');
      const classLabel = String(record[classField] || '');

      if (!audioPath || !classLabel) {
        skipped++;
        continue;
      }

      // Sanitize class label for folder name
      const sanitizedClass = classLabel
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .trim();

      if (!sanitizedClass) {
        skipped++;
        continue;
      }

      // Resolve source audio
      const srcPath = resolveAudioPath(audioPath, basePath);

      // Validate audio extension
      const ext = path.extname(audioPath).toLowerCase();
      if (!allowedExts.includes(ext)) {
        skipped++;
        continue;
      }

      // Handle filename collisions
      let destName = path.basename(audioPath);
      const collisionKey = `${sanitizedClass}/${destName}`;
      const count = filenameCounts.get(collisionKey) || 0;
      if (count > 0) {
        const nameWithoutExt = path.basename(destName, ext);
        destName = `${nameWithoutExt}_${count}${ext}`;
      }
      filenameCounts.set(collisionKey, count + 1);

      // Create class directory and copy audio
      const classDir = path.join(outputDir, sanitizedClass);
      await ensureDir(classDir);

      const destPath = path.join(classDir, destName);
      try {
        await copyAudio(srcPath, destPath);
      } catch {
        skipped++;
        continue;
      }

      const relativePath = `${sanitizedClass}/${destName}`;

      // Build metadata record with all extra fields
      const metaRecord: AudioFolderMetadataRecord = {
        file_name: relativePath,
        label: classLabel,
      };

      // Include extra fields from the record
      for (const [key, value] of Object.entries(record)) {
        if (key !== audioField && key !== classField) {
          metaRecord[key] = value;
        }
      }

      metadataRecords.push(metaRecord);
    }

    // Write metadata.csv
    if (metadataRecords.length > 0) {
      const csvPath = path.join(outputDir, 'metadata.csv');
      await writeData(csvPath, metadataRecords);
      outputFiles.push(csvPath);
    }

    // Write data.json
    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, metadataRecords, true);
    outputFiles.push(jsonPath);

    // Write data.jsonl
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = metadataRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    // Collect unique classes
    const classes = [...new Set(metadataRecords.map((r) => r.label))];

    return {
      outputDir,
      files: {
        all: outputFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'audiofolder-dataset',
        timestamp: Date.now(),
        counts: {
          train: metadataRecords.length,
          validation: 0,
          test: 0,
          total: metadataRecords.length,
        },
        stats: {
          fieldStats: {
            classes: {
              type: 'string',
              nonNull: classes.length,
              nullCount: 0,
            },
          },
        },
      },
    };
  }
}

/**
 * AudioFolder formatter instance
 */
export const audiofolderFormatter = new AudioFolderFormatter();

/**
 * Convenience function to format data
 */
export async function formatToAudioFolder(
  data: unknown[],
  outputDir: string,
  options: Partial<AudioFolderOptions> & { classField: string }
): Promise<FormattedOutput> {
  const formatter = new AudioFolderFormatter();
  const fullOptions: AudioFolderOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'audiofolder',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
