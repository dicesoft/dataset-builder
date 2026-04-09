/**
 * ChatML formatter
 * OpenAI's chat markup format for conversational data
 * Standard format for chat-based LLMs
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, ChatMLOptions } from '../types';
import { ensureDir, estimateTokens } from '../utils';

/**
 * ChatML message
 */
export interface ChatMLMessage {
  /** Message role */
  role: 'system' | 'user' | 'assistant';
  /** Message content */
  content: string;
}

/**
 * ChatML record format
 */
export interface ChatMLRecord {
  /** Array of messages in the conversation */
  messages: ChatMLMessage[];
}

/**
 * ChatML formatter implementation
 */
export class ChatMLFormatter implements Formatter<ChatMLOptions> {
  name = 'chatml';
  description = "OpenAI's chat markup format for conversational data";
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for ChatML format
   * Requires messages array or convertible fields
   */
  validate(input: unknown[], options?: Partial<ChatMLOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Per-record detection: check if this record has a messages field
      const hasMessagesField = 'messages' in record;

      if (hasMessagesField) {
        // Handle messages as string (JSON) or array
        let messages: unknown[] | null = null;
        if (Array.isArray(record.messages)) {
          messages = record.messages;
        } else if (typeof record.messages === 'string') {
          try {
            const parsed = JSON.parse(record.messages as string);
            if (Array.isArray(parsed)) {
              messages = parsed;
            }
          } catch {
            // Not valid JSON
          }
        }

        if (!messages) {
          errors.push({
            index: i,
            field: 'messages',
            message: 'Field "messages" must be an array or JSON string of an array',
            value: record.messages,
          });
          recordValid = false;
        } else if (messages.length === 0) {
          errors.push({
            index: i,
            field: 'messages',
            message: 'Messages array cannot be empty',
          });
          recordValid = false;
        } else {
          // Validate each message
          for (let j = 0; j < messages.length; j++) {
            const msg = messages[j] as Record<string, unknown>;
            if (
              typeof msg.role !== 'string' ||
              !['system', 'user', 'assistant'].includes(msg.role)
            ) {
              errors.push({
                index: i,
                field: `messages[${j}].role`,
                message: 'Message role must be "system", "user", or "assistant"',
                value: msg.role,
              });
              recordValid = false;
            }
            if (typeof msg.content !== 'string') {
              errors.push({
                index: i,
                field: `messages[${j}].content`,
                message: 'Message content must be a string',
                value: msg.content,
              });
              recordValid = false;
            }
          }
        }
      } else {
        // Check for convertible fields — if roleMap is provided, also accept mapped field names
        const userField = options?.roleMap?.user;
        const assistantField = options?.roleMap?.assistant;

        const hasInstruction =
          'instruction' in record ||
          'prompt' in record ||
          (userField ? userField in record : false);
        const hasOutput =
          'output' in record ||
          'completion' in record ||
          'response' in record ||
          (assistantField ? assistantField in record : false);

        if (!hasInstruction) {
          errors.push({
            index: i,
            message:
              'Record must have "instruction" or "prompt" field (or pre-formatted "messages" array)',
          });
          recordValid = false;
        }
        if (!hasOutput) {
          errors.push({
            index: i,
            message:
              'Record must have "output", "completion", or "response" field (or pre-formatted "messages" array)',
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
   * Format data to ChatML format
   */
  async format(input: unknown[], options: ChatMLOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    // If conversationIdField is set, group records by that field first
    let recordGroups: Record<string, unknown>[][];

    if (options.conversationIdField) {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const item of input) {
        const record = item as Record<string, unknown>;
        const groupKey = String(record[options.conversationIdField] ?? '');
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(record);
      }
      recordGroups = Array.from(groups.values());
    } else {
      // Each record is its own group (single-record conversations)
      recordGroups = input.map((item) => [item as Record<string, unknown>]);
    }

    const formatted: ChatMLRecord[] = [];
    let totalTokens = 0;

    for (const group of recordGroups) {
      const messages: ChatMLMessage[] = [];

      // Add system message if provided (once per conversation)
      const firstRecord = group[0];
      if (
        options.includeSystem !== false &&
        (options.systemPrompt || (firstRecord.system as string))
      ) {
        messages.push({
          role: 'system',
          content: (firstRecord.system as string) || options.systemPrompt || '',
        });
      }

      for (const record of group) {
        // Check if record already has messages (array or JSON string)
        if (record.messages !== undefined) {
          let parsed: ChatMLMessage[];
          if (Array.isArray(record.messages)) {
            parsed = record.messages as ChatMLMessage[];
          } else if (typeof record.messages === 'string') {
            try {
              parsed = JSON.parse(record.messages as string) as ChatMLMessage[];
            } catch {
              // If not valid JSON, treat as content
              messages.push({
                role: 'user',
                content: record.messages as string,
              });
              continue;
            }
          } else {
            continue;
          }

          // Apply roleMap remapping if provided
          if (options.roleMap) {
            for (const msg of parsed) {
              msg.role = remapRole(msg.role, options.roleMap);
            }
          }
          messages.push(...parsed);
        } else {
          // Build messages from fields, using roleMap to determine field sources
          let userFieldName = 'instruction';
          let assistantFieldName = 'output';

          if (options.roleMap) {
            if (options.roleMap.user) userFieldName = options.roleMap.user;
            if (options.roleMap.assistant) assistantFieldName = options.roleMap.assistant;
          }

          const instruction =
            (record[userFieldName] as string) ||
            (record.instruction as string) ||
            (record.prompt as string) ||
            '';
          const inputField = (record.input as string) || '';
          const output =
            (record[assistantFieldName] as string) ||
            (record.output as string) ||
            (record.completion as string) ||
            (record.response as string) ||
            '';

          // Add system from roleMap field if present
          if (options.roleMap?.system && record[options.roleMap.system]) {
            messages.push({
              role: 'system',
              content: record[options.roleMap.system] as string,
            });
          }

          // Combine instruction and input for user message
          const userContent = inputField ? `${instruction}\n\n${inputField}` : instruction;

          if (userContent) {
            messages.push({
              role: 'user',
              content: userContent,
            });
          }

          if (output) {
            messages.push({
              role: 'assistant',
              content: output,
            });
          }
        }
      }

      if (messages.length > 0) {
        formatted.push({ messages });
        // Accumulate token estimate
        const text = messages.map((m) => m.content).join(' ');
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
        datasetName: options.datasetName || 'chatml-dataset',
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
 * Remap a role string using the roleMap
 * The roleMap values are input field names that map TO standard roles.
 * When processing pre-formatted messages, we remap non-standard role names to standard ones.
 */
function remapRole(
  role: string,
  roleMap: { system?: string; user?: string; assistant?: string }
): 'system' | 'user' | 'assistant' {
  // If role matches a roleMap value, map it to the corresponding standard role
  if (roleMap.system && role === roleMap.system) return 'system';
  if (roleMap.user && role === roleMap.user) return 'user';
  if (roleMap.assistant && role === roleMap.assistant) return 'assistant';

  // Also handle common aliases
  const normalized = role.toLowerCase().trim();
  if (['system'].includes(normalized)) return 'system';
  if (['user', 'human', 'prompter'].includes(normalized)) return 'user';
  if (['assistant', 'gpt', 'bot', 'ai'].includes(normalized)) return 'assistant';

  // Default: keep as-is if it's already a valid role
  if (['system', 'user', 'assistant'].includes(normalized)) {
    return normalized as 'system' | 'user' | 'assistant';
  }
  return 'user';
}

/**
 * ChatML formatter instance
 */
export const chatmlFormatter = new ChatMLFormatter();

/**
 * Convenience function to format data
 */
export async function formatToChatML(
  data: unknown[],
  outputDir: string,
  options?: Partial<ChatMLOptions>
): Promise<FormattedOutput> {
  const formatter = new ChatMLFormatter();
  const fullOptions: ChatMLOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'chatml',
    includeSystem: true,
    ...options,
  };
  return formatter.format(data, fullOptions);
}
