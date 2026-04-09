/**
 * LLM processor for transform command
 * Batched processing with retry logic and progress callbacks
 */

import { getOllama, ModelNotFoundError, OllamaClient } from '../generators/ollama';
import {
  TransformOptions,
  TransformProgress,
  RelevanceScore,
  QAPair,
  ConversationTurn,
} from './types';
// extractFinalResponse is called inside ollama.ts generate() — not needed here
import { createOllamaQueue } from '../utils/concurrency';
import { logger } from '../utils/logger';

/** Tracks LLM failure types during batch processing */
export interface FailureBreakdown {
  emptyResponse: number;
  jsonParseError: number;
  idMismatch: number;
}

/** Extended Map that carries failure breakdown metadata */
export type QAResultMap = Map<string, QAPair> & { failureBreakdown?: FailureBreakdown };

/**
 * Error thrown when consecutive LLM failures trigger early abort in noFallback mode
 */
export class LLMAbortError extends Error {
  constructor(
    message: string,
    public readonly results: Map<string, unknown>
  ) {
    super(message);
    this.name = 'LLMAbortError';
  }
}

/** Progress tracker for batch operations */
interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  startTime: number;
}

/**
 * Simple LRU cache for prompt deduplication
 */
class PromptCache {
  private cache = new Map<string, { result: unknown; timestamp: number }>();
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.result;
    }
    return undefined;
  }

  set(key: string, result: unknown): void {
    if (this.cache.size >= this.maxSize) {
      // Delete oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}

/**
 * Attempt to parse JSON from LLM output that may be malformed.
 * Handles: direct JSON, markdown code blocks, embedded {...} in mixed text.
 * Returns null on failure instead of throwing.
 */
function tryParseJson(text: string): unknown | null {
  if (!text || !text.trim()) return null;

  // 1. Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // 2. Extract from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. Extract embedded {...} from mixed text
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

/** Simple hash for prompt deduplication */
function hashPrompt(prompt: string): string {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const chr = prompt.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return hash.toString(36);
}

// In-flight request deduplication
const inFlightRequests = new Map<string, Promise<unknown>>();
const promptCache = new PromptCache(100);

/**
 * Adaptive batch sizing: adjusts batch size based on observed performance
 */
class AdaptiveBatcher {
  private currentBatchSize: number;
  private readonly minBatchSize = 1;
  private readonly maxBatchSize: number;
  private lastBatchTime = 0;
  private consecutiveSuccesses = 0;

  constructor(initialBatchSize: number, maxBatchSize?: number) {
    this.currentBatchSize = initialBatchSize;
    this.maxBatchSize = maxBatchSize ?? initialBatchSize * 4;
  }

  get batchSize(): number {
    return this.currentBatchSize;
  }

  /** Report batch completion for adaptive sizing */
  reportSuccess(wallTimeMs: number, hadTruncation = false): void {
    this.lastBatchTime = wallTimeMs;

    if (hadTruncation) {
      // JSON truncation suggests context overflow — shrink
      this.currentBatchSize = Math.max(this.minBatchSize, Math.floor(this.currentBatchSize * 0.75));
      this.consecutiveSuccesses = 0;
      return;
    }

    this.consecutiveSuccesses++;

    // If batch completes quickly and succeeds, grow
    if (wallTimeMs < 2000 && this.consecutiveSuccesses >= 3) {
      this.currentBatchSize = Math.min(this.maxBatchSize, Math.floor(this.currentBatchSize * 1.25));
      this.consecutiveSuccesses = 0;
    }
  }

  reportFailure(): void {
    this.currentBatchSize = Math.max(this.minBatchSize, Math.floor(this.currentBatchSize / 2));
    this.consecutiveSuccesses = 0;
  }
}

/**
 * Score relevance of records using LLM
 */
export async function scoreRelevance(
  records: { id: string; text: string; title?: string }[],
  target: string,
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void
): Promise<Map<string, RelevanceScore>> {
  const results = new Map<string, RelevanceScore>();
  const ollama = getOllama();
  const model = options.model || ollama.getDefaultModel();
  const maxRetries = options.retries ?? 3;

  const progress: BatchProgress = {
    total: records.length,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  let totalFailures = 0;

  // Use batch size 1 for small models to improve reliability
  const isSmallModel = options.model && /:(0\.5|[123])b/i.test(options.model);
  const effectiveBatchSize = isSmallModel ? 1 : options.batchSize;
  if (isSmallModel) {
    logger.debug(`[scoreRelevance] Small model detected (${options.model}), using batch size 1`);
  }

  // Deduplicate identical input texts before sending to LLM
  const textGroups = new Map<string, typeof records>();
  const uniqueRecords: typeof records = [];
  for (const record of records) {
    const textHash = hashPrompt(record.text);
    const group = textGroups.get(textHash);
    if (group) {
      group.push(record);
    } else {
      textGroups.set(textHash, [record]);
      uniqueRecords.push(record);
    }
  }
  if (uniqueRecords.length < records.length) {
    logger.debug(`[LLM dedup] ${records.length} records -> ${uniqueRecords.length} unique texts`);
  }

  const abortSignal = {
    get aborted() {
      return !!(globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag;
    },
  };
  const queue = createOllamaQueue('text', { abortSignal });
  const batcher = new AdaptiveBatcher(effectiveBatchSize);

  // Split into batches using adaptive sizing
  const batches: (typeof uniqueRecords)[] = [];
  let pos = 0;
  while (pos < uniqueRecords.length) {
    const size = batcher.batchSize;
    batches.push(uniqueRecords.slice(pos, pos + size));
    pos += size;
  }

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'classification',
      message: `Scoring relevance: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''} [${queue.stats.running}/${queue.stats.running + queue.stats.queued} active]`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  // Process batches concurrently through the queue
  await queue.mapSettled(batches, async (batch) => {
    if (abortSignal.aborted) return;

    const batchStart = Date.now();
    try {
      await processRelevanceBatch(batch, target, model, results, maxRetries);
      batcher.reportSuccess(Date.now() - batchStart);
      progress.completed += batch.length;
    } catch (error) {
      batcher.reportFailure();
      // If batch fails, try record-by-record
      for (const record of batch) {
        if (abortSignal.aborted) break;
        try {
          await processRelevanceBatch([record], target, model, results, maxRetries);
          progress.completed++;
        } catch (recordError) {
          console.warn(`Failed to score relevance for ${record.id}:`, recordError);
          progress.failed++;
          totalFailures++;

          if (options.noFallback && totalFailures >= 5) {
            throw new LLMAbortError(`Aborting: ${totalFailures} total LLM failures`, results);
          }
        }
      }
    }

    reportProgress();
  });

  // Replicate results to duplicate records
  for (const [, group] of textGroups) {
    if (group.length > 1) {
      const representative = group[0];
      const result = results.get(representative.id);
      if (result) {
        for (let i = 1; i < group.length; i++) {
          results.set(group[i].id, { ...result });
        }
      }
    }
  }

  return results;
}

/**
 * Process a batch of relevance scoring with optional deduplication
 */
async function processRelevanceBatch(
  records: { id: string; text: string; title?: string }[],
  target: string,
  model: string,
  results: Map<string, RelevanceScore>,
  maxRetries = 3,
  client?: OllamaClient
): Promise<void> {
  const ollama = client ?? getOllama();
  const prompt = buildRelevancePrompt(records, target);
  const cacheKey = hashPrompt(prompt + model);

  // Check LRU cache
  const cached = promptCache.get(cacheKey);
  if (cached) {
    const parsed = cached as {
      scores: Array<{ id: string; score: number; relevant: boolean; reason: string }>;
    };
    if (parsed.scores) {
      for (const score of parsed.scores) {
        results.set(score.id, {
          score: Math.max(0, Math.min(1, score.score)),
          relevant: score.relevant,
          reason: score.reason,
        });
      }
      return;
    }
  }

  // Check in-flight dedup
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    const result = (await inFlight) as {
      scores?: Array<{ id: string; score: number; relevant: boolean; reason: string }>;
    };
    if (result?.scores) {
      for (const score of result.scores) {
        results.set(score.id, {
          score: Math.max(0, Math.min(1, score.score)),
          relevant: score.relevant,
          reason: score.reason,
        });
      }
      return;
    }
  }

  const request = (async () => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(
          `[LLM prompt] [attempt ${attempt}/${maxRetries}] (${prompt.length} chars): ${prompt.slice(0, 300)}`
        );
        const response = await ollama.generate({
          model,
          prompt,
          system:
            'You are a relevance scoring assistant. Rate how relevant content is to a target topic. Be objective and consistent.',
          format: {
            type: 'object',
            properties: {
              scores: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    score: { type: 'number' },
                    relevant: { type: 'boolean' },
                    reason: { type: 'string' },
                  },
                  required: ['id', 'score', 'relevant', 'reason'],
                },
              },
            },
            required: ['scores'],
          },
          temperature: 0.3,
        });

        const content = response.response;
        logger.debug(`[LLM raw] (${content.length} chars): ${content.slice(0, 500)}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = tryParseJson(content) as any;
        if (!parsed) {
          logger.debug(`[LLM full response on parse failure]: ${content}`);
          const preview = content.slice(0, 200) || '(empty)';
          throw new Error(
            `Failed to parse JSON from LLM response (${content.length} chars): ${preview}`
          );
        }

        if (parsed.scores && Array.isArray(parsed.scores)) {
          // Validate returned IDs against input IDs
          const inputIds = records.map((r) => r.id);
          const returnedIds = parsed.scores.map((s: { id: string }) => s.id);
          const missingIds = inputIds.filter((id) => !returnedIds.includes(id));
          const extraIds = returnedIds.filter((id: string) => !inputIds.includes(id));
          if (missingIds.length > 0 || extraIds.length > 0) {
            logger.debug(
              `[LLM ID mismatch] Expected: ${inputIds.join(',')}, Got: ${returnedIds.join(',')}`
            );
          }

          // Cache result
          promptCache.set(cacheKey, parsed);

          for (const score of parsed.scores) {
            results.set(score.id, {
              score: Math.max(0, Math.min(1, score.score)),
              relevant: score.relevant,
              reason: score.reason,
            });
          }
        }

        return parsed;
      } catch (error) {
        if (error instanceof ModelNotFoundError) throw error;
        if (attempt >= maxRetries) {
          throw error;
        }
        logger.debug(
          `[relevance] [attempt ${attempt}/${maxRetries}] failed, retrying in ${1000 * attempt}ms: ${error instanceof Error ? error.message : error}`
        );
        const delay = 1000 * attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  })();

  inFlightRequests.set(cacheKey, request);
  try {
    await request;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Build relevance scoring prompt
 */
function buildRelevancePrompt(
  records: { id: string; text: string; title?: string }[],
  target: string
): string {
  const items = records
    .map(
      (r) => `
ID: ${r.id}
Title: ${r.title || 'N/A'}
Text: ${r.text.slice(0, 500)}${r.text.length > 500 ? '...' : ''}
---`
    )
    .join('\n');

  return `Rate how relevant each item is to the target topic: "${target}"

${items}

For each item, provide:
- score: 0.0 to 1.0 (1.0 = highly relevant)
- relevant: true/false (true if score >= 0.5)
- reason: brief explanation

Respond with JSON in this format:
{
  "scores": [
    {"id": "item_id", "score": 0.8, "relevant": true, "reason": "Directly about target topic"}
  ]
}`;
}

/**
 * Generate Q&A pairs from records
 */
export async function generateQA(
  records: { id: string; text: string; title: string }[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void
): Promise<QAResultMap> {
  const results: QAResultMap = new Map<string, QAPair>();
  const failureBreakdown: FailureBreakdown = { emptyResponse: 0, jsonParseError: 0, idMismatch: 0 };
  const ollama = getOllama();
  const model = options.model || ollama.getDefaultModel();
  const maxRetries = options.retries ?? 3;

  const progress: BatchProgress = {
    total: records.length,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  let totalFailures = 0;

  // Use batch size 1 for small models to improve reliability
  const isSmallModel = options.model && /:(0\.5|[123])b/i.test(options.model);
  const effectiveBatchSize = isSmallModel ? 1 : options.batchSize;
  if (isSmallModel) {
    logger.debug(`[generateQA] Small model detected (${options.model}), using batch size 1`);
  }

  // Deduplicate identical input texts before sending to LLM
  const textGroups = new Map<string, typeof records>();
  const uniqueRecords: typeof records = [];
  for (const record of records) {
    const textHash = hashPrompt(record.text);
    const group = textGroups.get(textHash);
    if (group) {
      group.push(record);
    } else {
      textGroups.set(textHash, [record]);
      uniqueRecords.push(record);
    }
  }
  if (uniqueRecords.length < records.length) {
    logger.debug(`[LLM dedup] ${records.length} records -> ${uniqueRecords.length} unique texts`);
  }

  const abortSignal = {
    get aborted() {
      return !!(globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag;
    },
  };
  const queue = createOllamaQueue('text', { abortSignal });
  const batcher = new AdaptiveBatcher(effectiveBatchSize);

  const batches: (typeof uniqueRecords)[] = [];
  let pos = 0;
  while (pos < uniqueRecords.length) {
    const size = batcher.batchSize;
    batches.push(uniqueRecords.slice(pos, pos + size));
    pos += size;
  }

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'generation',
      message: `Generating Q&A: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''} [${queue.stats.running}/${queue.stats.running + queue.stats.queued} active]`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  await queue.mapSettled(batches, async (batch) => {
    if (abortSignal.aborted) return;

    const batchStart = Date.now();
    try {
      await processQABatch(batch, model, results, maxRetries, undefined, failureBreakdown);
      batcher.reportSuccess(Date.now() - batchStart);
      progress.completed += batch.length;
    } catch (error) {
      batcher.reportFailure();
      for (const record of batch) {
        if (abortSignal.aborted) break;
        try {
          await processQABatch([record], model, results, maxRetries, undefined, failureBreakdown);
          progress.completed++;
        } catch (recordError) {
          console.warn(`Failed to generate QA for ${record.id}:`, recordError);
          progress.failed++;
          totalFailures++;

          // Categorize the failure
          const errMsg = recordError instanceof Error ? recordError.message : String(recordError);
          if (errMsg.includes('(0 chars)') || errMsg.includes('(empty)')) {
            failureBreakdown.emptyResponse++;
          } else if (errMsg.includes('Failed to parse JSON')) {
            failureBreakdown.jsonParseError++;
          }

          if (options.noFallback && totalFailures >= 5) {
            throw new LLMAbortError(`Aborting: ${totalFailures} total LLM failures`, results);
          }
        }
      }
    }

    reportProgress();
  });

  // Replicate results to duplicate records
  for (const [, group] of textGroups) {
    if (group.length > 1) {
      const representative = group[0];
      const result = results.get(representative.id);
      if (result) {
        for (let i = 1; i < group.length; i++) {
          results.set(group[i].id, { ...result });
        }
      }
    }
  }

  results.failureBreakdown = failureBreakdown;
  return results;
}

/**
 * Process Q&A generation batch
 */
async function processQABatch(
  records: { id: string; text: string; title: string }[],
  model: string,
  results: Map<string, QAPair>,
  maxRetries = 3,
  client?: OllamaClient,
  failureBreakdown?: FailureBreakdown
): Promise<void> {
  const ollama = client ?? getOllama();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const prompt = buildQAPrompt(records);

      logger.debug(
        `[LLM prompt] [attempt ${attempt}/${maxRetries}] (${prompt.length} chars): ${prompt.slice(0, 300)}`
      );
      const response = await ollama.generate({
        model,
        prompt,
        system:
          'You are a dataset creator. Generate high-quality Q&A training pairs from articles. Questions should be natural and answers comprehensive.',
        format: {
          type: 'object',
          properties: {
            qa_pairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  instruction: { type: 'string' },
                  output: { type: 'string' },
                },
                required: ['id', 'instruction', 'output'],
              },
            },
          },
          required: ['qa_pairs'],
        },
        temperature: 0.5,
      });

      const content = response.response;
      logger.debug(`[LLM raw] (${content.length} chars): ${content.slice(0, 500)}`);
      if (!content || !content.trim()) {
        if (failureBreakdown) failureBreakdown.emptyResponse++;
        throw new Error(`Failed to parse JSON from LLM response (0 chars): (empty)`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = tryParseJson(content) as any;
      if (!parsed) {
        if (failureBreakdown) failureBreakdown.jsonParseError++;
        const preview = content.slice(0, 200) || '(empty)';
        throw new Error(
          `Failed to parse JSON from LLM response (${content.length} chars): ${preview}`
        );
      }

      if (parsed.qa_pairs && Array.isArray(parsed.qa_pairs)) {
        // Validate returned IDs against input IDs
        const inputIds = records.map((r) => r.id);
        const returnedIds = parsed.qa_pairs.map((qa: { id: string }) => qa.id);
        const missingIds = inputIds.filter((id) => !returnedIds.includes(id));
        const extraIds = returnedIds.filter((id: string) => !inputIds.includes(id));
        if (missingIds.length > 0 || extraIds.length > 0) {
          logger.debug(
            `[LLM ID mismatch] Expected: ${inputIds.join(',')}, Got: ${returnedIds.join(',')}`
          );
          if (failureBreakdown) failureBreakdown.idMismatch++;
        }

        for (const qa of parsed.qa_pairs) {
          results.set(qa.id, {
            instruction: qa.instruction,
            output: qa.output,
          });
        }
      }

      return;
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) {
        throw error;
      }
      logger.debug(
        `[QA] [attempt ${attempt}/${maxRetries}] failed, retrying in ${1000 * attempt}ms: ${error instanceof Error ? error.message : error}`
      );
      const delay = 1000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Build Q&A generation prompt
 */
function buildQAPrompt(records: { id: string; text: string; title: string }[]): string {
  const items = records
    .map(
      (r) => `
ID: ${r.id}
Title: ${r.title}
Text: ${r.text.slice(0, 2000)}${r.text.length > 2000 ? '...' : ''}
---`
    )
    .join('\n');

  return `Generate one high-quality Q&A training pair for each article.

${items}

Rules:
- Questions should be self-contained (don't reference "the article")
- Answers should be factual and based on the content
- Keep answers concise (1-3 paragraphs)

Respond with JSON:
{
  "qa_pairs": [
    {"id": "item_id", "instruction": "Natural question", "output": "Comprehensive answer"}
  ]
}`;
}

/**
 * Generate conversation from records
 */
export async function generateConversation(
  records: { id: string; text: string; title: string }[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void
): Promise<Map<string, ConversationTurn[]>> {
  const results = new Map<string, ConversationTurn[]>();
  const ollama = getOllama();
  const model = options.model || ollama.getDefaultModel();
  const maxRetries = options.retries ?? 3;

  const progress: BatchProgress = {
    total: records.length,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  let totalFailures = 0;

  const abortSignal = {
    get aborted() {
      return !!(globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag;
    },
  };
  const queue = createOllamaQueue('text', { abortSignal });

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'generation',
      message: `Generating conversations: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''} [${queue.stats.running}/${queue.stats.running + queue.stats.queued} active]`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  await queue.mapSettled(records, async (record) => {
    if (abortSignal.aborted) return;

    try {
      const conversation = await processConversation(record, model, maxRetries);
      results.set(record.id, conversation);
      progress.completed++;
    } catch (error) {
      console.warn(`Failed to generate conversation for ${record.id}:`, error);
      progress.failed++;
      totalFailures++;

      if (options.noFallback && totalFailures >= 5) {
        throw new LLMAbortError(`Aborting: ${totalFailures} total LLM failures`, results);
      }
    }

    reportProgress();
  });

  return results;
}

/**
 * Process single conversation generation
 */
async function processConversation(
  record: { id: string; text: string; title: string },
  model: string,
  maxRetries = 3,
  client?: OllamaClient
): Promise<ConversationTurn[]> {
  const ollama = client ?? getOllama();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const prompt = `Convert this article into a multi-turn conversation between a user and assistant.

Title: ${record.title}
Text: ${record.text.slice(0, 3000)}${record.text.length > 3000 ? '...' : ''}

Create 3-5 turns. The conversation should flow naturally.

Respond with JSON:
{
  "conversation": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}`;

      logger.debug(
        `[LLM prompt] [attempt ${attempt}/${maxRetries}] (${prompt.length} chars): ${prompt.slice(0, 300)}`
      );
      const response = await ollama.generate({
        model,
        prompt,
        system:
          'You create natural conversations from articles. Make dialogue realistic and informative.',
        format: {
          type: 'object',
          properties: {
            conversation: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
                required: ['role', 'content'],
              },
            },
          },
          required: ['conversation'],
        },
        temperature: 0.6,
      });

      const content = response.response;
      logger.debug(`[LLM raw] (${content.length} chars): ${content.slice(0, 500)}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = tryParseJson(content) as any;
      if (!parsed) {
        const preview = content.slice(0, 200) || '(empty)';
        throw new Error(
          `Failed to parse JSON from LLM response (${content.length} chars): ${preview}`
        );
      }

      if (parsed.conversation && Array.isArray(parsed.conversation)) {
        return parsed.conversation.map((turn: { role: string; content: string }) => ({
          role: turn.role as 'user' | 'assistant',
          content: turn.content,
        }));
      }

      throw new Error('Invalid response format');
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) {
        throw error;
      }
      logger.debug(
        `[conversation] [attempt ${attempt}/${maxRetries}] failed, retrying in ${1000 * attempt}ms: ${error instanceof Error ? error.message : error}`
      );
      const delay = 1000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Failed to generate conversation');
}

/**
 * Generate instruction-style output from records
 */
export async function generateInstruction(
  records: { id: string; text: string; title: string }[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void
): Promise<
  Map<
    string,
    {
      instruction: string;
      input: string;
      output: string;
    }
  >
> {
  const results = new Map<
    string,
    {
      instruction: string;
      input: string;
      output: string;
    }
  >();
  const ollama = getOllama();
  const model = options.model || ollama.getDefaultModel();
  const maxRetries = options.retries ?? 3;

  const progress: BatchProgress = {
    total: records.length,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  let totalFailures = 0;

  const abortSignal = {
    get aborted() {
      return !!(globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag;
    },
  };
  const queue = createOllamaQueue('text', { abortSignal });
  const batcher = new AdaptiveBatcher(options.batchSize);

  const batches: (typeof records)[] = [];
  let pos = 0;
  while (pos < records.length) {
    const size = batcher.batchSize;
    batches.push(records.slice(pos, pos + size));
    pos += size;
  }

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'generation',
      message: `Generating instructions: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''} [${queue.stats.running}/${queue.stats.running + queue.stats.queued} active]`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  await queue.mapSettled(batches, async (batch) => {
    if (abortSignal.aborted) return;

    const batchStart = Date.now();
    try {
      await processInstructionBatch(batch, model, results, maxRetries);
      batcher.reportSuccess(Date.now() - batchStart);
      progress.completed += batch.length;
    } catch (error) {
      batcher.reportFailure();
      for (const record of batch) {
        if (abortSignal.aborted) break;
        try {
          await processInstructionBatch([record], model, results, maxRetries);
          progress.completed++;
        } catch (recordError) {
          console.warn(`Failed to generate instruction for ${record.id}:`, recordError);
          progress.failed++;
          totalFailures++;

          if (options.noFallback && totalFailures >= 5) {
            throw new LLMAbortError(`Aborting: ${totalFailures} total LLM failures`, results);
          }
        }
      }
    }

    reportProgress();
  });

  return results;
}

/**
 * Process instruction generation batch
 */
async function processInstructionBatch(
  records: { id: string; text: string; title: string }[],
  model: string,
  results: Map<string, { instruction: string; input: string; output: string }>,
  maxRetries = 3,
  client?: OllamaClient
): Promise<void> {
  const ollama = client ?? getOllama();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const items = records
        .map(
          (r) => `
ID: ${r.id}
Title: ${r.title}
Text: ${r.text.slice(0, 2000)}${r.text.length > 2000 ? '...' : ''}
---`
        )
        .join('\n');

      const prompt = `Generate instruction-following training data from each article.

${items}

Create a natural instruction and comprehensive response.

Respond with JSON:
{
  "instructions": [
    {"id": "item_id", "instruction": "...", "input": "...", "output": "..."}
  ]
}`;

      logger.debug(
        `[LLM prompt] [attempt ${attempt}/${maxRetries}] (${prompt.length} chars): ${prompt.slice(0, 300)}`
      );
      const response = await ollama.generate({
        model,
        prompt,
        system:
          'You create instruction-following training data. Instructions should be clear and outputs comprehensive.',
        format: {
          type: 'object',
          properties: {
            instructions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  instruction: { type: 'string' },
                  input: { type: 'string' },
                  output: { type: 'string' },
                },
                required: ['id', 'instruction', 'output'],
              },
            },
          },
          required: ['instructions'],
        },
        temperature: 0.5,
      });

      const content = response.response;
      logger.debug(`[LLM raw] (${content.length} chars): ${content.slice(0, 500)}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = tryParseJson(content) as any;
      if (!parsed) {
        const preview = content.slice(0, 200) || '(empty)';
        throw new Error(
          `Failed to parse JSON from LLM response (${content.length} chars): ${preview}`
        );
      }

      if (parsed.instructions && Array.isArray(parsed.instructions)) {
        for (const inst of parsed.instructions) {
          results.set(inst.id, {
            instruction: inst.instruction,
            input: inst.input || '',
            output: inst.output,
          });
        }
      }

      return;
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) {
        throw error;
      }
      logger.debug(
        `[instruct] [attempt ${attempt}/${maxRetries}] failed, retrying in ${1000 * attempt}ms: ${error instanceof Error ? error.message : error}`
      );
      const delay = 1000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Global abort flag
export function setTransformAbortFlag(value: boolean): void {
  (globalThis as typeof globalThis & { transformAbortFlag?: boolean }).transformAbortFlag = value;
}

/** Exported for testing */
export { tryParseJson as _tryParseJson };

/** Clear prompt cache and in-flight requests (for testing) */
export function clearPromptCache(): void {
  promptCache['cache'].clear();
  inFlightRequests.clear();
}
