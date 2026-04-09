/**
 * SpeechText formatter
 * Speech transcription format: audio path + transcription text + optional duration
 * Produces { audio, text, duration? } records for ASR/TTS datasets
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, SpeechTextOptions } from '../types';
import { ensureDir, writeData } from '../utils';
import {
  resolveAudioPath,
  validateAudio,
  copyAudio,
  getAudioMetadata,
  DEFAULT_AUDIO_EXTENSIONS,
} from './utils';

/**
 * SpeechText output record
 */
export interface SpeechTextRecord {
  audio: string;
  text: string;
  duration?: number;
  [key: string]: unknown;
}

/**
 * SpeechText formatter implementation
 */
export class SpeechTextFormatter implements Formatter<SpeechTextOptions> {
  name = 'speech-text';
  description = 'Speech transcription format (audio + text pairs with optional duration)';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for SpeechText format
   * Requires audioField and text field
   */
  validate(input: unknown[], options?: Partial<SpeechTextOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const audioField = options?.audioField || 'audio';
    const textField = options?.textField || 'text';

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

      // Check text field
      const textValue = record[textField];
      if (textValue === undefined || textValue === null || textValue === '') {
        errors.push({
          index: i,
          field: textField,
          message: `Required field "${textField}" is missing or empty`,
          value: textValue,
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
   * Format data to SpeechText format
   * Produces { audio, text, duration? } records
   */
  async format(input: unknown[], options: SpeechTextOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const audioField = options.audioField || 'audio';
    const textField = options.textField || 'text';
    const durationField = options.durationField;
    const extractDuration = options.extractDuration || false;
    const allowedExts = options.audioExtensions || DEFAULT_AUDIO_EXTENSIONS;
    const basePath = options.basePath;

    const outputRecords: SpeechTextRecord[] = [];
    const outputFiles: string[] = [];
    let skipped = 0;

    // Create audio dir if copying
    const audioDir = path.join(outputDir, 'audio');
    if (options.copyMedia) {
      await ensureDir(audioDir);
    }

    // Track filename collisions
    const filenameCounts = new Map<string, number>();

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const audioPath = String(record[audioField] || '');
      const textValue = record[textField];

      if (!audioPath || textValue === undefined || textValue === null || textValue === '') {
        skipped++;
        continue;
      }

      // Resolve and validate audio
      const fullAudioPath = resolveAudioPath(audioPath, basePath);
      const validation = await validateAudio(fullAudioPath, allowedExts);
      if (!validation.valid) {
        skipped++;
        continue;
      }

      // Build output record
      const outputRecord: SpeechTextRecord = {
        audio: audioPath,
        text: String(textValue),
      };

      // Get duration from existing field or ffprobe
      if (durationField && record[durationField] !== undefined) {
        const dur = Number(record[durationField]);
        if (!isNaN(dur)) {
          outputRecord.duration = dur;
        }
      } else if (extractDuration) {
        const metadata = await getAudioMetadata(fullAudioPath);
        if (metadata.duration !== undefined) {
          outputRecord.duration = metadata.duration;
        }
      }

      // Copy audio if requested
      if (options.copyMedia) {
        let destName = path.basename(audioPath);
        const count = filenameCounts.get(destName) || 0;
        if (count > 0) {
          const ext = path.extname(destName);
          const nameWithoutExt = path.basename(destName, ext);
          destName = `${nameWithoutExt}_${count}${ext}`;
        }
        filenameCounts.set(path.basename(audioPath), count + 1);

        const destPath = path.join(audioDir, destName);
        try {
          await copyAudio(fullAudioPath, destPath);
          outputRecord.audio = `audio/${destName}`;
        } catch {
          // Keep original path on copy failure
        }
      }

      outputRecords.push(outputRecord);
    }

    // Write data.json
    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, outputRecords, true);
    outputFiles.push(jsonPath);

    // Write data.jsonl
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = outputRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    // Write data.csv
    const csvPath = path.join(outputDir, 'data.csv');
    await writeData(csvPath, outputRecords);
    outputFiles.push(csvPath);

    return {
      outputDir,
      files: {
        all: outputFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'speech-text-dataset',
        timestamp: Date.now(),
        counts: {
          train: outputRecords.length,
          validation: 0,
          test: 0,
          total: outputRecords.length,
        },
      },
    };
  }
}

/**
 * SpeechText formatter instance
 */
export const speechTextFormatter = new SpeechTextFormatter();

/**
 * Convenience function to format data
 */
export async function formatToSpeechText(
  data: unknown[],
  outputDir: string,
  options?: Partial<SpeechTextOptions>
): Promise<FormattedOutput> {
  const formatter = new SpeechTextFormatter();
  const fullOptions: SpeechTextOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'speech-text',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
