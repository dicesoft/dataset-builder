/**
 * Translation engine for dataset translation via LLM (Ollama)
 * Processes records in batches using structured output for reliable JSON responses
 */

import { getOllama } from '../generators/ollama';
import { verboseLog } from '../utils/logger';
import { resolveLanguage, type LanguageInfo } from './languages';
import { createOllamaQueue, ConcurrencyQueue } from '../utils/concurrency';

export interface TranslateOptions {
  model: string;
  targetLanguages: LanguageInfo[];
  sourceLanguage?: string;
  batchSize: number;
  fieldsToTranslate?: string[];
  fieldsToExclude?: string[];
  temperature?: number;
  maxRetries: number;
  delayMs?: number;
}

export interface TranslationProgress {
  totalRecords: number;
  totalLanguages: number;
  currentLanguage: string;
  currentLanguageIndex: number;
  recordsCompleted: number;
  recordsFailed: number;
  currentBatchStart: number;
  currentBatchEnd: number;
  status: 'translating' | 'completed' | 'aborted' | 'error';
  startTime: number;
  estimatedTimeRemaining: number;
}

export interface TranslationResult {
  language: LanguageInfo;
  records: Record<string, unknown>[];
  failedCount: number;
  duration: number;
}

let abortFlag = false;

/** Set abort flag for graceful shutdown */
export function setAbortFlag(value: boolean): void {
  abortFlag = value;
}

/** Check if abort was requested */
export function isAborted(): boolean {
  return abortFlag;
}

/**
 * Build a JSON schema from the first record's shape for structured output
 */
export function buildSchemaFromRecords(
  records: Record<string, unknown>[],
  fieldsToTranslate?: string[],
  fieldsToExclude?: string[]
): object {
  if (records.length === 0) return { type: 'array', items: { type: 'object' } };

  const sample = records[0];
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(sample)) {
    required.push(key);

    if (value === null || value === undefined) {
      properties[key] = { type: 'string' };
    } else if (typeof value === 'string') {
      properties[key] = { type: 'string' };
    } else if (typeof value === 'number') {
      properties[key] = { type: 'number' };
    } else if (typeof value === 'boolean') {
      properties[key] = { type: 'boolean' };
    } else if (Array.isArray(value)) {
      properties[key] = { type: 'array', items: { type: 'string' } };
    } else if (typeof value === 'object') {
      properties[key] = { type: 'object' };
    } else {
      properties[key] = { type: 'string' };
    }
  }

  return {
    type: 'array',
    items: {
      type: 'object',
      properties,
      required,
    },
  };
}

/**
 * Build a translation prompt for a batch of records
 */
function buildTranslationPrompt(
  records: Record<string, unknown>[],
  targetLanguage: LanguageInfo,
  sourceLanguage?: string,
  fieldsToTranslate?: string[],
  fieldsToExclude?: string[]
): string {
  const sourceHint = sourceLanguage ? ` from ${sourceLanguage}` : '';

  const fieldInstructions: string[] = [];
  if (fieldsToTranslate && fieldsToTranslate.length > 0) {
    fieldInstructions.push(
      `Only translate these fields: ${fieldsToTranslate.join(', ')}. Leave all other fields unchanged.`
    );
  }
  if (fieldsToExclude && fieldsToExclude.length > 0) {
    fieldInstructions.push(
      `Do NOT translate these fields: ${fieldsToExclude.join(', ')}. Leave them unchanged.`
    );
  }

  return `Translate the following JSON array of records${sourceHint} to ${targetLanguage.name} (${targetLanguage.nativeName}).

Rules:
- Translate only string values that contain natural language text
- Preserve all keys exactly as they are (do not translate keys)
- Preserve numbers, booleans, URLs, email addresses, and code exactly as they are
- Preserve any IDs, codes, or technical identifiers
- Return the same number of records in the same order
${fieldInstructions.length > 0 ? fieldInstructions.join('\n') + '\n' : ''}
Input records:
${JSON.stringify(records, null, 2)}`;
}

/**
 * Attempt deterministic JSON repairs (borrowed from structured.ts patterns)
 */
function repairJson(raw: string): unknown | null {
  let str = raw.trim();

  // Strip markdown fences
  if (str.startsWith('```')) {
    const match = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) str = match[1].trim();
  }

  // Try direct parse
  try {
    return JSON.parse(str);
  } catch {
    // continue to repairs
  }

  // Remove trailing commas
  str = str.replace(/,\s*([}\]])/g, '$1');

  // Normalize quotes
  str = str.replace(/[\u201C\u201D]/g, '"');
  str = str.replace(/[\u2018\u2019]/g, "'");

  // Remove comments
  str = str.replace(/\/\/.*$/gm, '');
  str = str.replace(/\/\*[\s\S]*?\*\//g, '');

  // Balance brackets
  let open = 0;
  let close = 0;
  for (const char of str) {
    if (char === '{' || char === '[') open++;
    if (char === '}' || char === ']') close++;
  }
  if (open > close) {
    // Determine what's missing based on first char
    const firstBracket = str.trim()[0];
    const closer = firstBracket === '[' ? ']' : '}';
    str = str + closer.repeat(open - close);
  }

  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Translate a single batch of records for a target language
 */
async function translateBatch(
  records: Record<string, unknown>[],
  targetLanguage: LanguageInfo,
  options: TranslateOptions,
  client?: import('../generators/ollama').OllamaClient
): Promise<Record<string, unknown>[] | null> {
  const ollama = client ?? getOllama();
  const schema = buildSchemaFromRecords(
    records,
    options.fieldsToTranslate,
    options.fieldsToExclude
  );

  const prompt = buildTranslationPrompt(
    records,
    targetLanguage,
    options.sourceLanguage,
    options.fieldsToTranslate,
    options.fieldsToExclude
  );

  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      verboseLog(
        `Batch translation attempt ${attempt}/${options.maxRetries} for ${targetLanguage.name}`
      );

      const response = await ollama.generate({
        model: options.model,
        prompt,
        system:
          'You are a professional translator. Translate JSON records accurately while preserving structure. Return only valid JSON.',
        temperature: options.temperature ?? 0.3,
        format: schema,
      });

      const raw = response.response.trim();
      let parsed: unknown;

      try {
        parsed = JSON.parse(raw);
      } catch {
        verboseLog(`JSON parse failed on attempt ${attempt}, attempting repair`);
        parsed = repairJson(raw);
      }

      if (parsed && Array.isArray(parsed)) {
        verboseLog(`Batch translated successfully: ${parsed.length} records`);
        return parsed as Record<string, unknown>[];
      }

      verboseLog(`Attempt ${attempt}: response was not a valid array`);
    } catch (error: any) {
      verboseLog(`Attempt ${attempt} error: ${error.message}`);
    }

    if (attempt < options.maxRetries) {
      const delay = 1000 * attempt; // exponential backoff
      verboseLog(`Waiting ${delay}ms before retry...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return null;
}

/**
 * Translate a single record (fallback when batch fails)
 */
async function translateSingleRecord(
  record: Record<string, unknown>,
  targetLanguage: LanguageInfo,
  options: TranslateOptions
): Promise<Record<string, unknown> | null> {
  const result = await translateBatch([record], targetLanguage, options);
  return result && result.length > 0 ? result[0] : null;
}

/**
 * Main translation function: translates a dataset to multiple target languages
 */
export async function translateDataset(
  records: Record<string, unknown>[],
  options: TranslateOptions,
  onProgress?: (progress: TranslationProgress) => void
): Promise<TranslationResult[]> {
  abortFlag = false;
  const results: TranslationResult[] = [];
  const startTime = Date.now();
  const delayMs = options.delayMs ?? 200;

  for (let langIdx = 0; langIdx < options.targetLanguages.length; langIdx++) {
    if (abortFlag) break;

    const targetLanguage = options.targetLanguages[langIdx];
    const langStart = Date.now();
    const translatedRecords: Record<string, unknown>[] = [];
    let failedCount = 0;

    // Pre-split into batches with dynamic sizing
    interface BatchInfo {
      start: number;
      records: Record<string, unknown>[];
    }
    const batchInfos: BatchInfo[] = [];
    {
      let pos = 0;
      while (pos < records.length) {
        let currentBatchSize = options.batchSize;
        let batch = records.slice(pos, pos + currentBatchSize);
        while (currentBatchSize > 1 && JSON.stringify(batch).length > 8000) {
          currentBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
          batch = records.slice(pos, pos + currentBatchSize);
        }
        batchInfos.push({ start: pos, records: batch });
        pos += currentBatchSize;
      }
    }

    const queue = createOllamaQueue('text');

    // Process batches concurrently, collecting results in order
    const batchResults = new Array<Record<string, unknown>[]>(batchInfos.length);

    const reportProgress = () => {
      if (!onProgress) return;
      const elapsedNow = Date.now() - startTime;
      const doneSoFar = langIdx * records.length + translatedRecords.length;
      const totalAll = options.targetLanguages.length * records.length;
      const rateNow = doneSoFar > 0 ? elapsedNow / doneSoFar : 0;
      onProgress({
        totalRecords: records.length,
        totalLanguages: options.targetLanguages.length,
        currentLanguage: targetLanguage.name,
        currentLanguageIndex: langIdx,
        recordsCompleted: translatedRecords.length,
        recordsFailed: failedCount,
        currentBatchStart: translatedRecords.length + 1,
        currentBatchEnd: Math.min(translatedRecords.length + options.batchSize, records.length),
        status: 'translating',
        startTime,
        estimatedTimeRemaining: (totalAll - doneSoFar) * rateNow,
      });
    };

    await queue.mapSettled(batchInfos, async (info, batchIdx) => {
      if (abortFlag) return;

      verboseLog(
        `Translating batch ${info.start + 1}-${info.start + info.records.length} of ${records.length} to ${targetLanguage.name}`
      );

      const batchResult = await translateBatch(info.records, targetLanguage, options);

      if (batchResult && batchResult.length === info.records.length) {
        batchResults[batchIdx] = batchResult;
      } else if (batchResult && batchResult.length > 0) {
        batchResults[batchIdx] = batchResult;
        failedCount += info.records.length - batchResult.length;
      } else {
        // Batch failed — try record by record
        verboseLog(
          `Batch failed, falling back to record-by-record for ${info.records.length} records`
        );
        const fallbackResults: Record<string, unknown>[] = [];
        for (const record of info.records) {
          if (abortFlag) break;
          const single = await translateSingleRecord(record, targetLanguage, options);
          if (single) {
            fallbackResults.push(single);
          } else {
            fallbackResults.push(record);
            failedCount++;
          }
        }
        batchResults[batchIdx] = fallbackResults;
      }
    });

    // Collect results in order
    for (const br of batchResults) {
      if (br) translatedRecords.push(...br);
    }
    reportProgress();

    results.push({
      language: targetLanguage,
      records: translatedRecords,
      failedCount,
      duration: Date.now() - langStart,
    });
  }

  // Final progress update
  if (onProgress) {
    onProgress({
      totalRecords: records.length,
      totalLanguages: options.targetLanguages.length,
      currentLanguage: results[results.length - 1]?.language.name || '',
      currentLanguageIndex: options.targetLanguages.length - 1,
      recordsCompleted: records.length,
      recordsFailed: 0,
      currentBatchStart: records.length,
      currentBatchEnd: records.length,
      status: abortFlag ? 'aborted' : 'completed',
      startTime,
      estimatedTimeRemaining: 0,
    });
  }

  return results;
}
