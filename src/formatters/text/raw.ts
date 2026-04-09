/**
 * Raw formatter
 * Simple prompt/completion pairs
 * Most basic format for instruction tuning
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, FormatOptions, ValidationResult, FormattedOutput } from '../types';
import { ensureDir, estimateTokens } from '../utils';

/**
 * Raw record format
 */
export interface RawRecord {
  /** The prompt/instruction */
  prompt: string;
  /** The expected completion/response */
  completion: string;
}

/**
 * Raw formatter implementation
 */
export class RawFormatter implements Formatter<FormatOptions> {
  name = 'raw';
  description = 'Simple prompt/completion pairs for instruction tuning';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for Raw format
   */
  validate(input: unknown[], _options?: Partial<FormatOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check for prompt field (or alternatives)
      const promptValue = record.prompt || record.instruction || record.input;
      if (!promptValue || typeof promptValue !== 'string') {
        errors.push({
          index: i,
          field: 'prompt',
          message: 'Record must have "prompt", "instruction", or "input" field',
          value: promptValue,
        });
        recordValid = false;
      }

      // Check for completion field (or alternatives)
      const completionValue = record.completion || record.output || record.response;
      if (!completionValue || typeof completionValue !== 'string') {
        errors.push({
          index: i,
          field: 'completion',
          message: 'Record must have "completion", "output", or "response" field',
          value: completionValue,
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
   * Format data to Raw format
   */
  async format(input: unknown[], options: FormatOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const formatted: RawRecord[] = [];

    for (const item of input) {
      const record = item as Record<string, string>;

      const prompt = record.prompt || record.instruction || record.input || '';
      const completion = record.completion || record.output || record.response || '';

      if (prompt && completion) {
        formatted.push({ prompt, completion });
      }
    }

    // Write JSON output
    const jsonPath = path.join(outputDir, 'data.json');
    await fs.writeFile(jsonPath, JSON.stringify(formatted, null, 2), 'utf-8');

    // Write JSONL output
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = formatted.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');

    // Also write as CSV
    const csvPath = path.join(outputDir, 'data.csv');
    const csvHeader = 'prompt,completion';
    const csvRows = formatted.map((r) => {
      const prompt = `"${r.prompt.replace(/"/g, '""')}"`;
      const completion = `"${r.completion.replace(/"/g, '""')}"`;
      return `${prompt},${completion}`;
    });
    await fs.writeFile(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf-8');

    // Compute token stats
    const totalTokens = formatted.reduce((sum, r) => {
      return sum + estimateTokens(`${r.prompt} ${r.completion}`);
    }, 0);

    return {
      outputDir,
      files: {
        all: [jsonPath, jsonlPath, csvPath],
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'raw-dataset',
        timestamp: Date.now(),
        counts: {
          train: formatted.length,
          validation: 0,
          test: 0,
          total: formatted.length,
        },
        stats: {
          totalTokens,
          avgTokensPerRecord: formatted.length > 0 ? Math.ceil(totalTokens / formatted.length) : 0,
        },
      },
    };
  }
}

/**
 * Raw formatter instance
 */
export const rawFormatter = new RawFormatter();

/**
 * Convenience function to format data
 */
export async function formatToRaw(
  data: unknown[],
  outputDir: string,
  options?: Partial<FormatOptions>
): Promise<FormattedOutput> {
  const formatter = new RawFormatter();
  const fullOptions: FormatOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'raw',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
