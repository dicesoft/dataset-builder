/**
 * Alpaca formatter
 * Stanford's instruction-following format
 * Most common format for fine-tuning LLMs
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  Formatter,
  FormatOptions,
  ValidationResult,
  FormattedOutput,
  AlpacaOptions,
} from '../types';
import { ensureDir, writeData, estimateTokens } from '../utils';

/**
 * Alpaca record format
 */
export interface AlpacaRecord {
  /** Instruction/prompt */
  instruction: string;
  /** Optional input context */
  input?: string;
  /** Expected output/response */
  output: string;
}

/**
 * Alpaca formatter implementation
 */
export class AlpacaFormatter implements Formatter<AlpacaOptions> {
  name = 'alpaca';
  description = "Stanford's instruction-following format for fine-tuning LLMs";
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for Alpaca format
   * Requires at minimum 'instruction' and 'output' fields
   */
  validate(input: unknown[], options?: Partial<AlpacaOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;

    // Required fields
    const requiredFields = ['instruction', 'output'];
    const optionalFields = ['input'];

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check required fields
      for (const field of requiredFields) {
        const value = record[field];
        if (value === undefined || value === null || value === '') {
          errors.push({
            index: i,
            field,
            message: `Required field "${field}" is missing or empty`,
            value,
          });
          recordValid = false;
        } else if (typeof value !== 'string') {
          errors.push({
            index: i,
            field,
            message: `Field "${field}" must be a string`,
            value,
          });
          recordValid = false;
        }
      }

      // Check optional fields exist but are strings if present
      for (const field of optionalFields) {
        const value = record[field];
        if (value !== undefined && value !== null && typeof value !== 'string') {
          errors.push({
            index: i,
            field,
            message: `Optional field "${field}" must be a string if provided`,
            value,
          });
          recordValid = false;
        }
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
   * Format data to Alpaca format
   */
  async format(input: unknown[], options: AlpacaOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    // Transform to Alpaca format
    const formatted: AlpacaRecord[] = input.map((item) => {
      const record = item as Record<string, string>;
      const alpacaRecord: AlpacaRecord = {
        instruction: record.instruction || '',
        output: record.output || '',
      };
      const inputValue = record.input || options.defaultInput || '';
      if (inputValue || options.includeEmptyInput !== false) {
        alpacaRecord.input = inputValue;
      }
      return alpacaRecord;
    });

    // Filter out records with empty required fields
    const validRecords = formatted.filter((r) => r.instruction.trim() && r.output.trim());

    // Write output file
    const outputPath = path.join(outputDir, 'data.json');
    await writeData(outputPath, validRecords, true);

    // Also write JSONL version
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = validRecords.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');

    // Compute token stats
    const totalTokens = validRecords.reduce((sum, r) => {
      return sum + estimateTokens(`${r.instruction} ${r.input || ''} ${r.output}`);
    }, 0);

    return {
      outputDir,
      files: {
        all: [outputPath, jsonlPath],
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'alpaca-dataset',
        timestamp: Date.now(),
        counts: {
          train: validRecords.length,
          validation: 0,
          test: 0,
          total: validRecords.length,
        },
        stats: {
          totalTokens,
          avgTokensPerRecord:
            validRecords.length > 0 ? Math.ceil(totalTokens / validRecords.length) : 0,
        },
      },
    };
  }
}

/**
 * Alpaca formatter instance
 */
export const alpacaFormatter = new AlpacaFormatter();

/**
 * Convenience function to format data
 */
export async function formatToAlpaca(
  data: unknown[],
  outputDir: string,
  options?: Partial<AlpacaOptions>
): Promise<FormattedOutput> {
  const formatter = new AlpacaFormatter();
  const fullOptions: AlpacaOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'alpaca',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
