/**
 * OpenAssistant (OASST) formatter
 * Message tree format used by OpenAssistant project
 * Supports hierarchical conversation trees with parent-child references
 */

import fs from 'fs/promises';
import path from 'path';
import type { Formatter, ValidationResult, FormattedOutput, OASSTOptions } from '../types';
import { ensureDir, estimateTokens } from '../utils';

/**
 * OASST message node in a conversation tree
 */
export interface OASSTMessage {
  /** Unique message ID */
  message_id: string;
  /** Parent message ID (null for root messages) */
  parent_id: string | null;
  /** Message text content */
  text: string;
  /** Role of the message author */
  role: 'prompter' | 'assistant';
  /** Language code (e.g., "en") */
  lang?: string;
}

/**
 * OASST conversation tree record
 */
export interface OASSTRecord {
  /** Unique message tree ID */
  message_tree_id: string;
  /** Ordered list of messages in the tree */
  messages: OASSTMessage[];
}

/**
 * OpenAssistant formatter implementation
 */
export class OASSTFormatter implements Formatter<OASSTOptions> {
  name = 'oasst';
  description = 'OpenAssistant conversation tree format with message threading';
  supportedInputFormats = ['json', 'jsonl', 'csv'];

  /**
   * Validate data for OASST format
   * Accepts either pre-formatted OASST records or convertible fields
   */
  validate(input: unknown[], options?: Partial<OASSTOptions>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    let validCount = 0;
    const validRoles = ['prompter', 'assistant', 'user', 'human', 'system', 'gpt', 'bot', 'ai'];

    for (let i = 0; i < input.length; i++) {
      const record = input[i] as Record<string, unknown>;
      let recordValid = true;

      // Per-record: check if this record has a messages array
      const hasMessages = 'messages' in record;

      if (hasMessages) {
        // Validate pre-formatted OASST structure
        const messages = record.messages;
        if (!Array.isArray(messages)) {
          errors.push({
            index: i,
            field: 'messages',
            message: 'Field "messages" must be an array',
            value: messages,
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
          for (let j = 0; j < messages.length; j++) {
            const msg = messages[j] as Record<string, unknown>;
            if (
              typeof msg.role !== 'string' ||
              !validRoles.includes((msg.role as string).toLowerCase())
            ) {
              errors.push({
                index: i,
                field: `messages[${j}].role`,
                message: `Message role must be one of: ${validRoles.join(', ')}`,
                value: msg.role,
              });
              recordValid = false;
            }
            if (typeof msg.text !== 'string' && typeof msg.content !== 'string') {
              errors.push({
                index: i,
                field: `messages[${j}].text`,
                message: 'Message must have "text" or "content" field as a string',
                value: msg.text,
              });
              recordValid = false;
            }
          }
        }
      } else {
        // Check for convertible fields (instruction/output pairs)
        const hasPrompt =
          'instruction' in record ||
          'prompt' in record ||
          'input' in record ||
          'human' in record ||
          'user' in record;
        const hasResponse =
          'output' in record ||
          'completion' in record ||
          'response' in record ||
          'assistant' in record ||
          'gpt' in record;

        if (!hasPrompt) {
          errors.push({
            index: i,
            message:
              'Record must have a prompt field (instruction/prompt/input/human/user) or pre-formatted "messages" array',
          });
          recordValid = false;
        }
        if (!hasResponse) {
          errors.push({
            index: i,
            message:
              'Record must have a response field (output/completion/response/assistant/gpt) or pre-formatted "messages" array',
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
   * Format data to OASST format
   */
  async format(input: unknown[], options: OASSTOptions): Promise<FormattedOutput> {
    const outputDir = options.outputDir;
    await ensureDir(outputDir);

    const formatted: OASSTRecord[] = [];
    let treeIndex = 0;
    let totalTokens = 0;

    for (const item of input) {
      const record = item as Record<string, unknown>;
      const messages: OASSTMessage[] = [];

      // Use treeIdField option if set, otherwise fall back to hardcoded chain
      let treeId: string;
      if (options.treeIdField) {
        treeId = (record[options.treeIdField] as string) || `tree_${treeIndex}`;
      } else {
        treeId =
          (record.message_tree_id as string) ||
          (record.thread_id as string) ||
          (record.conversation_id as string) ||
          `tree_${treeIndex}`;
      }

      // Add system prompt as root prompter message if provided
      if (options.systemPrompt) {
        const systemId = `${treeId}_msg_system`;
        messages.push({
          message_id: systemId,
          parent_id: null,
          text: options.systemPrompt,
          role: 'prompter',
          ...(options.lang ? { lang: options.lang } : {}),
        });
      }

      if (Array.isArray(record.messages)) {
        // Pre-formatted messages - convert to OASST structure
        let msgIndex = 0;
        const parentOffset = messages.length; // Account for system prompt if added
        for (const msg of record.messages as Record<string, unknown>[]) {
          const role = mapToOASSTRole(msg.role as string);
          const text =
            (msg.text as string) || (msg.content as string) || (msg.value as string) || '';
          const messageId =
            (msg.message_id as string) || `${treeId}_msg_${msgIndex + parentOffset}`;

          // Use parentIdField option if set, otherwise fall back to hardcoded parent_id
          let parentId: string | null;
          const parentIdSource = options.parentIdField
            ? (msg[options.parentIdField] as string | undefined)
            : (msg.parent_id as string | undefined);

          if (parentIdSource !== undefined) {
            parentId = parentIdSource;
          } else if (msgIndex > 0 || messages.length > 0) {
            // Link to previous message (either last system prompt msg or previous in-array msg)
            const prevId =
              msgIndex > 0
                ? `${treeId}_msg_${msgIndex + parentOffset - 1}`
                : messages[messages.length - 1].message_id;
            parentId = prevId;
          } else {
            parentId = null;
          }

          if (text) {
            messages.push({
              message_id: messageId,
              parent_id: parentId,
              text,
              role,
              ...(options.lang ? { lang: options.lang } : {}),
            });
          }
          msgIndex++;
        }
      } else {
        // Build from flat fields
        const promptText =
          (record.instruction as string) ||
          (record.prompt as string) ||
          (record.input as string) ||
          (record.human as string) ||
          (record.user as string) ||
          '';

        const responseText =
          (record.output as string) ||
          (record.completion as string) ||
          (record.response as string) ||
          (record.assistant as string) ||
          (record.gpt as string) ||
          '';

        if (promptText) {
          const rootId = `${treeId}_msg_${messages.length}`;
          const parentId = messages.length > 0 ? messages[messages.length - 1].message_id : null;
          messages.push({
            message_id: rootId,
            parent_id: parentId,
            text: promptText,
            role: 'prompter',
            ...(options.lang ? { lang: options.lang } : {}),
          });

          if (responseText) {
            messages.push({
              message_id: `${treeId}_msg_${messages.length}`,
              parent_id: rootId,
              text: responseText,
              role: 'assistant',
              ...(options.lang ? { lang: options.lang } : {}),
            });
          }
        }
      }

      if (messages.length > 0) {
        formatted.push({
          message_tree_id: treeId,
          messages,
        });
        const text = messages.map((m) => m.text).join(' ');
        totalTokens += estimateTokens(text);
      }
      treeIndex++;
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
        datasetName: options.datasetName || 'oasst-dataset',
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
 * Map common role names to OASST roles
 */
function mapToOASSTRole(role: string): 'prompter' | 'assistant' {
  const normalizedRole = (role || '').toLowerCase().trim();

  switch (normalizedRole) {
    case 'prompter':
    case 'human':
    case 'user':
    case 'system': // system messages treated as prompter in OASST
      return 'prompter';
    case 'assistant':
    case 'gpt':
    case 'bot':
    case 'ai':
      return 'assistant';
    default:
      return 'prompter';
  }
}

/**
 * OASST formatter instance
 */
export const oasstFormatter = new OASSTFormatter();

/**
 * Convenience function to format data
 */
export async function formatToOASST(
  data: unknown[],
  outputDir: string,
  options?: Partial<OASSTOptions>
): Promise<FormattedOutput> {
  const formatter = new OASSTFormatter();
  const fullOptions: OASSTOptions = {
    outputDir,
    fieldMap: {},
    formatter: 'oasst',
    ...options,
  };
  return formatter.format(data, fullOptions);
}
