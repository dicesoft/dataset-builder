/**
 * ShareGPT formatter
 * Multi-turn conversation format
 * Popular format for conversation datasets
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, ShareGPTOptions } from '../types';
import { ensureDir, estimateTokens } from '../utils';

/**
 * ShareGPT conversation turn
 */
export interface ShareGPTTurn {
  /** Who sent the message: 'human', 'gpt', or 'system' */
  from: 'human' | 'gpt' | 'system';
  /** Message content */
  value: string;
}

/**
 * ShareGPT record format
 */
export interface ShareGPTRecord {
  /** Array of conversation turns */
  conversations: ShareGPTTurn[];
}

/**
 * ShareGPT formatter implementation
 */
export class ShareGPTFormatter implements Formatter<ShareGPTOptions> {
  name = 'sharegpt';
  description = 'Multi-turn conversation format for chat datasets';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for ShareGPT format
   */
  validate(input: unknown[], options?: Partial<ShareGPTOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Per-record detection: check if this specific record has conversations
      const hasConversationsField = 'conversations' in record;

      if (hasConversationsField) {
        // Handle conversations as array or JSON string
        let conversations: unknown[] | null = null;
        if (Array.isArray(record.conversations)) {
          conversations = record.conversations;
        } else if (typeof record.conversations === 'string') {
          try {
            const parsed = JSON.parse(record.conversations as string);
            if (Array.isArray(parsed)) {
              conversations = parsed;
            }
          } catch {
            // Not valid JSON
          }
        }

        if (!conversations) {
          errors.push({
            index: i,
            field: 'conversations',
            message: 'Field "conversations" must be an array or JSON string of an array',
            value: record.conversations,
          });
          recordValid = false;
        } else if (conversations.length < 1) {
          errors.push({
            index: i,
            field: 'conversations',
            message: 'Conversations must have at least 1 turn',
          });
          recordValid = false;
        } else {
          // Validate each turn
          for (let j = 0; j < conversations.length; j++) {
            const turn = conversations[j] as Record<string, unknown>;
            if (typeof turn.from !== 'string' || !['human', 'gpt', 'system'].includes(turn.from)) {
              errors.push({
                index: i,
                field: `conversations[${j}].from`,
                message: 'Turn "from" must be "human", "gpt", or "system"',
                value: turn.from,
              });
              recordValid = false;
            }
            if (typeof turn.value !== 'string') {
              errors.push({
                index: i,
                field: `conversations[${j}].value`,
                message: 'Turn "value" must be a string',
                value: turn.value,
              });
              recordValid = false;
            }
          }
        }
      } else {
        // Check for convertible fields
        const hasHuman =
          'human' in record || 'user' in record || 'input' in record || 'instruction' in record;
        const hasAssistant =
          'gpt' in record || 'assistant' in record || 'output' in record || 'completion' in record;

        if (!hasHuman) {
          errors.push({
            index: i,
            message: 'Record must have human/user field (or pre-formatted "conversations" array)',
          });
          recordValid = false;
        }
        if (!hasAssistant) {
          errors.push({
            index: i,
            message:
              'Record must have gpt/assistant field (or pre-formatted "conversations" array)',
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
   * Format data to ShareGPT format
   */
  async format(input: unknown[], options: ShareGPTOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    // If conversationField is set, group records by that field first
    let recordGroups: Record<string, unknown>[][];

    if (options.conversationField) {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const item of input) {
        const record = item as Record<string, unknown>;
        const groupKey = String(record[options.conversationField] ?? '');
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(record);
      }
      recordGroups = Array.from(groups.values());
    } else {
      // Each record is its own group
      recordGroups = input.map((item) => [item as Record<string, unknown>]);
    }

    const formatted: ShareGPTRecord[] = [];
    let totalTokens = 0;

    for (const group of recordGroups) {
      const conversations: ShareGPTTurn[] = [];

      // Add system prompt if provided, or use record.system field (once per conversation)
      const firstRecord = group[0];
      const systemContent = options.systemPrompt || (firstRecord.system as string);
      if (systemContent) {
        conversations.push({ from: 'system', value: systemContent });
      }

      for (const record of group) {
        // Check if record already has conversations (array or JSON string)
        if (record.conversations !== undefined) {
          let parsed: ShareGPTTurn[];
          if (Array.isArray(record.conversations)) {
            parsed = record.conversations as ShareGPTTurn[];
          } else if (typeof record.conversations === 'string') {
            try {
              parsed = JSON.parse(record.conversations as string) as ShareGPTTurn[];
            } catch {
              // Treat as simple conversation
              conversations.push(
                { from: 'human', value: record.conversations as string },
                { from: 'gpt', value: '' }
              );
              continue;
            }
          } else {
            continue;
          }
          conversations.push(...parsed);
        } else {
          // Build from individual fields
          const humanField = options.humanField || 'human';
          const assistantField = options.assistantField || 'gpt';

          const humanMessage =
            (record[humanField] as string) ||
            (record.user as string) ||
            (record.input as string) ||
            (record.instruction as string) ||
            '';
          const assistantMessage =
            (record[assistantField] as string) ||
            (record.assistant as string) ||
            (record.output as string) ||
            (record.completion as string) ||
            (record.response as string) ||
            '';

          if (humanMessage) {
            conversations.push({ from: 'human', value: humanMessage });
          }
          if (assistantMessage) {
            conversations.push({ from: 'gpt', value: assistantMessage });
          }
        }
      }

      if (conversations.length >= 1) {
        formatted.push({ conversations });
        const text = conversations.map((t) => t.value).join(' ');
        totalTokens += estimateTokens(text);
      }
    }

    // Write JSON output
    const jsonPath = path.join(outputDir, 'data.json');
    await fs.writeFile(jsonPath, JSON.stringify(formatted, null, 2), 'utf-8');

    // Write JSONL output
    const jsonlPath = path.join(outputDir, 'data.jsonl');
    const jsonlContent = formatted.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(jsonlPath, jsonlContent, 'utf-8');

    return {
      outputDir,
      files: {
        all: [jsonPath, jsonlPath],
      },
      metadata: {
        formatter: this.name,
        datasetName: options.datasetName || 'sharegpt-dataset',
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
 * ShareGPT formatter instance
 */
export const sharegptFormatter = new ShareGPTFormatter();

/**
 * Convenience function to format data
 */
export async function formatToShareGPT(
  data: unknown[],
  outputDir: string,
  options?: Partial<ShareGPTOptions>
): Promise<FormattedOutput> {
  const formatter = new ShareGPTFormatter();
  const fullOptions: ShareGPTOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'sharegpt',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
