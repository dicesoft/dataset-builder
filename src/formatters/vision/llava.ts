/**
 * LLaVA formatter
 * Visual instruction tuning format for multimodal LLMs
 * Output: { conversations: [{from, value}], image: "path" }
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, LLaVAOptions } from '../types';
import { ensureDir, writeData, estimateTokens } from '../utils';
import { resolveImagePath, validateImage, copyImage, imageToBase64 } from './utils';

/**
 * LLaVA conversation turn
 */
export interface LLaVATurn {
  from: 'human' | 'gpt';
  value: string;
}

/**
 * LLaVA record format
 */
export interface LLaVARecord {
  conversations: LLaVATurn[];
  image: string;
}

/**
 * LLaVA formatter implementation
 */
export class LLaVAFormatter implements Formatter<LLaVAOptions> {
  name = 'llava';
  description = 'Visual instruction tuning format for multimodal LLMs (LLaVA)';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for LLaVA format
   * Requires image field and either conversations array or instruction/output fields
   */
  validate(input: unknown[], options?: Partial<LLaVAOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const imageField = options?.imageField || 'image';

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Check image field
      const imgValue = record[imageField];
      if (!imgValue || typeof imgValue !== 'string') {
        errors.push({
          index: i,
          field: imageField,
          message: `Required field "${imageField}" must be a non-empty string`,
          value: imgValue,
        });
        recordValid = false;
      }

      // Check for conversations or instruction/output
      const hasConversations = Array.isArray(record.conversations);
      const hasInstruction = record.instruction || record.question || record.prompt;
      const hasOutput = record.output || record.answer || record.response;

      if (!hasConversations && !hasInstruction) {
        errors.push({
          index: i,
          message: 'Record must have "conversations" array or instruction/question/prompt field',
        });
        recordValid = false;
      }

      if (!hasConversations && !hasOutput) {
        errors.push({
          index: i,
          message: 'Record must have "conversations" array or output/answer/response field',
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
   * Format data to LLaVA format
   */
  async format(input: unknown[], options: LLaVAOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const imageField = options.imageField || 'image';
    const imageToken = options.imageToken || '<image>';
    const embedImages = options.embedImages || false;
    const maxEmbedSize = options.maxEmbedSize || 10 * 1024 * 1024; // 10MB default
    const basePath = options.basePath;

    const formatted: LLaVARecord[] = [];
    const outputFiles: string[] = [];
    let totalTokens = 0;
    let skipped = 0;

    // Create images dir if copying
    const imagesDir = path.join(outputDir, 'images');
    if (options.copyMedia) {
      await ensureDir(imagesDir);
    }

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const imgPath = String(record[imageField] || '');

      if (!imgPath) {
        skipped++;
        continue;
      }

      // Build conversations
      const conversations: LLaVATurn[] = [];

      if (Array.isArray(record.conversations)) {
        // Use pre-formatted conversations
        for (const turn of record.conversations) {
          const t = turn as Record<string, string>;
          conversations.push({
            from: t.from === 'gpt' || t.from === 'assistant' ? 'gpt' : 'human',
            value: String(t.value || ''),
          });
        }
      } else {
        // Build from instruction/output fields
        const instruction = String(record.instruction || record.question || record.prompt || '');
        const output = String(record.output || record.answer || record.response || '');

        if (!instruction && !output) {
          skipped++;
          continue;
        }

        // Prepend image token to the first human message if not already present
        const humanValue = instruction.includes(imageToken)
          ? instruction
          : `${imageToken}\n${instruction}`;

        conversations.push({ from: 'human', value: humanValue }, { from: 'gpt', value: output });
      }

      if (conversations.length === 0) {
        skipped++;
        continue;
      }

      // Resolve and handle image
      let outputImgPath = imgPath;

      if (options.copyMedia) {
        const srcPath = resolveImagePath(imgPath, basePath);
        const destName = path.basename(imgPath);
        const destPath = path.join(imagesDir, destName);
        try {
          await copyImage(srcPath, destPath);
          outputImgPath = `images/${destName}`;
        } catch {
          // Skip if image copy fails
          skipped++;
          continue;
        }
      }

      // Handle base64 embedding
      if (embedImages) {
        const srcPath = resolveImagePath(imgPath, basePath);
        const base64 = await imageToBase64(srcPath, maxEmbedSize);
        if (base64) {
          const ext = path.extname(imgPath).toLowerCase().slice(1);
          outputImgPath = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`;
        }
      }

      const llavaRecord: LLaVARecord = {
        conversations,
        image: outputImgPath,
      };

      formatted.push(llavaRecord);

      const text = conversations.map((t) => t.value).join(' ');
      totalTokens += estimateTokens(text);
    }

    // Write data.json
    const jsonPath = path.join(outputDir, 'data.json');
    await writeData(jsonPath, formatted, true);
    outputFiles.push(jsonPath);

    // Write data.jsonl
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = formatted.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');
    outputFiles.push(jsonlPath);

    return {
      outputDir,
      files: {
        all: outputFiles,
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'llava-dataset',
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
 * LLaVA formatter instance
 */
export const llavaFormatter = new LLaVAFormatter();

/**
 * Convenience function to format data
 */
export async function formatToLLaVA(
  data: unknown[],
  outputDir: string,
  options?: Partial<LLaVAOptions>
): Promise<FormattedOutput> {
  const formatter = new LLaVAFormatter();
  const fullOptions: LLaVAOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'llava',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
