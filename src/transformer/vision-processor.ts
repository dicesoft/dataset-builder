/**
 * Vision processor for transform command
 * Handles image classification and captioning with vision models
 */

import { getConfig } from '../config';
import { TransformOptions, TransformProgress, ImageClassification, ObjectDetection } from './types';
import { AssetRecord } from '../downloader/types';
import { extractFinalResponse, getOllama, ModelNotFoundError } from '../generators/ollama';
import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { getImageDimensions } from './image-utils';
import { createOllamaQueue } from '../utils/concurrency';
import { isJsonMode } from '../utils/output';
import { verboseLog } from '../utils/logger';
import { TransformDecisionLog } from './decision-log';

/** Image formats supported by most local Ollama vision models (JPEG, PNG, BMP) */
export const SUPPORTED_VISION_FORMATS = new Set(['.jpg', '.jpeg', '.png', '.bmp']);

/**
 * Check if an asset's image format is supported by the vision model.
 * Cloud models support all formats; local Ollama models only support SUPPORTED_VISION_FORMATS.
 * Returns the lowercase file extension, or null if the format is supported.
 */
function checkUnsupportedFormat(asset: AssetRecord, model: string): string | null {
  if (isCloudModel(model)) return null;
  const ext = path.extname(asset.localPath || asset.fileName).toLowerCase();
  return SUPPORTED_VISION_FORMATS.has(ext) ? null : ext;
}

/**
 * Error thrown when consecutive vision failures trigger early abort in noFallback mode
 */
export class VisionAbortError extends Error {
  constructor(
    message: string,
    public readonly results: Map<string, unknown>
  ) {
    super(message);
    this.name = 'VisionAbortError';
  }
}

/**
 * Try to parse JSON from LLM response text.
 * Handles: raw JSON, markdown code blocks, embedded JSON in mixed text.
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

/**
 * Fuzzy-match a label to the nearest provided label from a constrained set.
 * Uses case-insensitive substring matching and Levenshtein distance.
 * Returns the best match, or the original label if no match is close enough.
 */
export function fuzzyMatchLabel(label: string, allowedLabels: string[]): string {
  if (allowedLabels.length === 0) return label;

  const lower = label.toLowerCase().trim();

  // Exact match (case-insensitive)
  for (const allowed of allowedLabels) {
    if (allowed.toLowerCase() === lower) return allowed;
  }

  // Substring match — label contains or is contained by an allowed label
  for (const allowed of allowedLabels) {
    const allowedLower = allowed.toLowerCase();
    if (lower.includes(allowedLower) || allowedLower.includes(lower)) {
      return allowed;
    }
  }

  // Levenshtein distance — pick closest
  let bestMatch = allowedLabels[0];
  let bestDist = Infinity;
  for (const allowed of allowedLabels) {
    const dist = levenshteinDistance(lower, allowed.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = allowed;
    }
  }

  // Only accept if distance is within half the label length (reasonable threshold)
  const maxDist = Math.max(3, Math.floor(lower.length / 2));
  return bestDist <= maxDist ? bestMatch : allowedLabels[0];
}

/**
 * Compute Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/** Progress tracker */
interface VisionProgress {
  total: number;
  completed: number;
  failed: number;
  startTime: number;
}

/**
 * Check if a model is a cloud model (not local Ollama)
 */
function isCloudModel(model: string): boolean {
  return (
    model.includes(':cloud') ||
    model.startsWith('kimi') ||
    model.startsWith('gemini') ||
    model.startsWith('claude')
  );
}

/**
 * Classify images using vision models
 */
export async function classifyImages(
  assets: AssetRecord[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void,
  decisionLog?: TransformDecisionLog
): Promise<Map<string, ImageClassification>> {
  const results = new Map<string, ImageClassification>();
  const config = getConfig();
  const model = options.model || config.get('ollamaModel') || 'llava';
  const target = options.target || 'general';
  const maxRetries = options.retries ?? 3;

  // Check if using cloud model - warn but continue
  if (isCloudModel(model)) {
    if (!isJsonMode()) {
      console.warn(
        chalk.yellow('\n⚠️  Using cloud model for vision: ') +
          chalk.cyan(model) +
          chalk.yellow(
            '\n   Make sure your Ollama server is configured to route to the cloud provider.'
          ) +
          chalk.gray('\n   Or use a local vision model: --model llava\n')
      );
    }
    verboseLog(`Using cloud model for vision: ${model}`);
  }

  const progress: VisionProgress = {
    total: assets.length,
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
  const queue = createOllamaQueue('vision', { abortSignal });

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'vision',
      message: `Classifying images: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''}`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  await queue.mapSettled(assets, async (asset) => {
    if (abortSignal.aborted) return;

    const baseDir = options.assetDir || path.dirname(options.input);
    const fullPath = path.resolve(baseDir, asset.localPath);
    if (process.env.NODE_ENV !== 'test') {
      try {
        await fs.access(fullPath);
      } catch {
        if (!isJsonMode()) {
          console.warn(
            `Image not found: ${fullPath}\n  Base directory: ${baseDir}\n  Asset localPath: ${asset.localPath}\n  Hint: If input is a directory, ensure assetDir matches the task folder.`
          );
        }
        verboseLog(
          `Image not found: ${fullPath} (baseDir=${baseDir}, localPath=${asset.localPath})`
        );
        decisionLog?.log({
          recordId: asset.id,
          stage: 'classify',
          action: 'drop',
          reason: 'file_not_found',
          details: { fullPath, baseDir, localPath: asset.localPath },
        });
        progress.failed++;
        reportProgress();
        return;
      }
    }

    // Format pre-check: skip VLLM for unsupported formats on local models
    const unsupportedExt = checkUnsupportedFormat(asset, model);
    if (unsupportedExt) {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'classify',
        action: 'drop',
        reason: `unsupported_format: ${unsupportedExt}`,
        details: { fileName: asset.fileName, format: unsupportedExt },
      });
      progress.failed++;
      reportProgress();
      return;
    }

    if (options.noLlm) {
      const fallbackLabel = inferLabelFromPath(asset.localPath, target);
      results.set(asset.id, {
        label: fallbackLabel,
        relevance: 0.5,
        caption: `Image from ${asset.sourcePageTitle || 'unknown source'}`,
        reason: 'Deterministic fallback (noLlm)',
      });
      decisionLog?.log({
        recordId: asset.id,
        stage: 'classify',
        action: 'keep',
        reason: 'deterministic_classification',
        details: { label: fallbackLabel },
      });
      progress.completed++;
    } else {
      try {
        const classification = await classifySingleImage(
          fullPath,
          target,
          model,
          maxRetries,
          !!options.noThink,
          options.labels
        );
        results.set(asset.id, classification);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'classify',
          action: 'keep',
          reason: 'vision_classification',
          details: { label: classification.label, relevance: classification.relevance },
        });
        progress.completed++;
      } catch (error) {
        if (!isJsonMode()) {
          console.warn(`Failed to classify ${asset.fileName}:`, error);
        }
        verboseLog(`Failed to classify ${asset.fileName}: ${error}`);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'classify',
          action: 'fallback',
          reason: 'classification_failed',
          details: { error: String(error) },
        });
        progress.failed++;
        totalFailures++;

        if (options.noFallback && totalFailures >= 5) {
          throw new VisionAbortError(`Aborting: ${totalFailures} total VLLM failures`, results);
        }
      }
    }

    reportProgress();
  });

  return results;
}

/**
 * Classify a single image
 */
async function classifySingleImage(
  imagePath: string,
  target: string,
  model: string,
  maxRetries = 3,
  noThink = false,
  labels?: string[]
): Promise<ImageClassification> {
  const ollama = getOllama();

  const jsonSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      label: labels && labels.length > 0 ? { type: 'string', enum: labels } : { type: 'string' },
      relevance: { type: 'number', minimum: 0, maximum: 1 },
      caption: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['label', 'relevance', 'caption', 'reason'],
  };

  const labelConstraint =
    labels && labels.length > 0
      ? `\nLABEL CONSTRAINT: You MUST pick the label from this list: [${labels.map((l) => `"${l}"`).join(', ')}]. Do NOT invent new labels.`
      : '';

  const calibrationBlock = `
RELEVANCE SCORING RUBRIC (be strict — most random images should score 0.1-0.3):
- 0.0-0.2: No relation to "${target}" — completely off-topic, random, or unrelated content
- 0.2-0.4: Weak/tangential relation — same broad domain but not actually "${target}"
- 0.4-0.6: Partial match — contains "${target}" but not the main subject, or ambiguous
- 0.6-0.8: Good match — "${target}" is clearly present and a primary subject
- 0.8-1.0: Excellent match — image is clearly and specifically about "${target}"

IMPORTANT: Score LOW if the image does NOT depict "${target}". A picture of a random object, logo, screenshot, or unrelated scene should score below 0.3 even if found on a page about "${target}".`;

  const prompt = `Analyze this image. Target topic: "${target}".${labelConstraint}
${calibrationBlock}

Respond ONLY with JSON:
{
  "label": "${labels && labels.length > 0 ? 'one of the allowed labels' : 'specific category label'}",
  "relevance": 0.0-1.0,
  "caption": "one sentence describing the image",
  "reason": "brief explanation of why this relevance score was given"
}`;

  // Simplified prompt for final retry — strips calibration to reduce parse failures on small models
  const simplifiedPrompt = `Analyze this image. Target topic: "${target}".${labelConstraint}

Respond ONLY with JSON:
{
  "label": "${labels && labels.length > 0 ? 'one of the allowed labels' : 'specific category label'}",
  "relevance": 0.0-1.0,
  "caption": "one sentence describing the image",
  "reason": "brief explanation"
}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let useFormat: object | undefined = jsonSchema;
      // On final retry, use simplified prompt to reduce parse failures on small models
      const activePrompt = attempt === maxRetries ? simplifiedPrompt : prompt;

      let content = await ollama.chat({
        model,
        messages: [{ role: 'user', content: activePrompt, images: [imagePath] }],
        temperature: 0.3,
        format: useFormat,
        think: !noThink,
      });

      content = extractFinalResponse(content);

      // If empty response (thinking model + format conflict), retry without format
      if (!content.trim()) {
        useFormat = undefined;
        content = await ollama.chat({
          model,
          messages: [{ role: 'user', content: activePrompt, images: [imagePath] }],
          temperature: 0.3,
          think: !noThink,
        });
        content = extractFinalResponse(content);
      }

      const parsed = tryParseJson(content) as Record<string, unknown> | null;
      if (!parsed) {
        throw new Error('Failed to parse JSON from response');
      }

      let resultLabel = (parsed.label as string) || 'unknown';
      // Fuzzy-snap non-compliant VLLM output to nearest provided label
      if (labels && labels.length > 0) {
        resultLabel = fuzzyMatchLabel(resultLabel, labels);
      }

      return {
        label: resultLabel,
        relevance: Math.max(0, Math.min(1, (parsed.relevance as number) || 0)),
        caption: (parsed.caption as string) || 'No caption available',
        reason: (parsed.reason as string) || 'No reason provided',
      };
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) {
        throw error;
      }
      const delay = 2000 * attempt; // Longer delay for vision
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Failed to classify image');
}

/**
 * Discover natural category labels from a sample of images.
 * Classifies each sampled image with free-form labeling, then collects unique raw labels.
 */
export async function discoverLabels(
  assets: AssetRecord[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void
): Promise<string[]> {
  const config = getConfig();
  const model = options.model || config.get('ollamaModel') || 'llava';
  const sampleCount = Math.min(options.autoLabelsCount || 20, assets.length);
  const maxRetries = options.retries ?? 3;
  const noThink = !!options.noThink;

  // Sample images: pick evenly spaced from the asset list for diversity
  const sampled: AssetRecord[] = [];
  if (sampleCount >= assets.length) {
    sampled.push(...assets);
  } else {
    const step = assets.length / sampleCount;
    for (let i = 0; i < sampleCount; i++) {
      sampled.push(assets[Math.floor(i * step)]);
    }
  }

  const rawLabels: string[] = [];
  const baseDir = options.assetDir || path.dirname(options.input);

  for (let i = 0; i < sampled.length; i++) {
    const asset = sampled[i];
    const fullPath = path.resolve(baseDir, asset.localPath);

    // Skip unsupported formats
    const unsupportedExt = checkUnsupportedFormat(asset, model);
    if (unsupportedExt) continue;

    // Check file exists (skip in test)
    if (process.env.NODE_ENV !== 'test') {
      try {
        await fs.access(fullPath);
      } catch {
        continue;
      }
    }

    progressCb?.({
      total: sampled.length,
      completed: i,
      stage: 'discovery',
      message: `Discovering categories: ${i}/${sampled.length}`,
    });

    try {
      // Classify with free-form labels (no label constraint)
      const classification = await classifySingleImage(
        fullPath,
        options.target || 'general',
        model,
        maxRetries,
        noThink,
        undefined // No label constraint for discovery
      );
      if (classification.label && classification.label !== 'unknown') {
        rawLabels.push(classification.label);
      }
    } catch {
      // Skip failed images during discovery
    }
  }

  progressCb?.({
    total: sampled.length,
    completed: sampled.length,
    stage: 'discovery',
    message: `Discovery complete: ${rawLabels.length} raw labels from ${sampled.length} images`,
  });

  return rawLabels;
}

/**
 * Consolidate raw labels using a text LLM to merge synonyms and near-duplicates.
 * E.g., ["kitten", "kitty", "baby cat", "dog", "puppy"] → ["kitten", "dog"]
 */
export async function consolidateLabels(
  rawLabels: string[],
  options: TransformOptions
): Promise<string[]> {
  if (rawLabels.length === 0) return [];

  // Deduplicate (case-insensitive) first
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const label of rawLabels) {
    const lower = label.toLowerCase().trim();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(label.trim());
    }
  }

  // If few enough unique labels, skip LLM consolidation
  if (unique.length <= 3) return unique;

  const ollama = getOllama();
  const config = getConfig();
  const textModel = config.get('ollamaGenerateModel') || config.get('ollamaModel') || 'llama3';

  const prompt = `You are a data labeling assistant. Given these raw category labels from image classification, merge synonyms and near-duplicates into a clean, minimal set of distinct category names.

Raw labels: ${JSON.stringify(unique)}

Rules:
- Merge synonyms (e.g., "kitten" and "kitty" and "baby cat" → pick the most common/clear one)
- Keep labels that represent genuinely different categories
- Return a JSON array of strings, nothing else
- Use lowercase labels
- Aim for the smallest set that covers all distinct categories

Respond ONLY with a JSON array, e.g.: ["cat", "dog", "bird"]`;

  try {
    let content = await ollama.chat({
      model: textModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      format: { type: 'array', items: { type: 'string' } },
    });

    content = extractFinalResponse(content);
    const parsed = tryParseJson(content);

    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((l: unknown) => typeof l === 'string')
    ) {
      return parsed as string[];
    }
  } catch {
    // If LLM consolidation fails, fall back to deduped unique labels
    verboseLog('Label consolidation LLM call failed, using deduplicated labels');
  }

  return unique;
}

/**
 * Generate captions for images
 */
export async function captionImages(
  assets: AssetRecord[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void,
  decisionLog?: TransformDecisionLog
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const config = getConfig();
  const model = options.model || config.get('ollamaModel') || 'llava';
  const maxRetries = options.retries ?? 3;

  // Check if using cloud model - warn but continue
  if (isCloudModel(model)) {
    if (!isJsonMode()) {
      console.warn(
        chalk.yellow('\n⚠️  Using cloud model for vision: ') +
          chalk.cyan(model) +
          chalk.yellow(
            '\n   Make sure your Ollama server is configured to route to the cloud provider.'
          ) +
          chalk.gray('\n   Or use a local vision model: --model llava\n')
      );
    }
    verboseLog(`Using cloud model for vision: ${model}`);
  }

  const progress: VisionProgress = {
    total: assets.length,
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
  const queue = createOllamaQueue('vision', { abortSignal });

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'vision',
      message: `Captioning images: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''}`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  await queue.mapSettled(assets, async (asset) => {
    if (abortSignal.aborted) return;

    const baseDir = options.assetDir || path.dirname(options.input);
    const fullPath = path.resolve(baseDir, asset.localPath);
    if (process.env.NODE_ENV !== 'test') {
      try {
        await fs.access(fullPath);
      } catch {
        if (!isJsonMode()) {
          console.warn(
            `Image not found: ${fullPath}\n  Base directory: ${baseDir}\n  Asset localPath: ${asset.localPath}\n  Hint: If input is a directory, ensure assetDir matches the task folder.`
          );
        }
        verboseLog(
          `Image not found: ${fullPath} (baseDir=${baseDir}, localPath=${asset.localPath})`
        );
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'drop',
          reason: 'file_not_found',
          details: { fullPath, baseDir, localPath: asset.localPath },
        });
        progress.failed++;
        reportProgress();
        return;
      }
    }

    // Format pre-check: skip VLLM for unsupported formats on local models
    const unsupportedExt = checkUnsupportedFormat(asset, model);
    if (unsupportedExt) {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'generate',
        action: 'drop',
        reason: `unsupported_format: ${unsupportedExt}`,
        details: { fileName: asset.fileName, format: unsupportedExt },
      });
      progress.failed++;
      reportProgress();
      return;
    }

    if (options.noLlm) {
      const caption =
        asset.context?.altText || `Image from ${asset.sourcePageTitle || 'unknown source'}`;
      results.set(asset.id, caption);
      decisionLog?.log({
        recordId: asset.id,
        stage: 'generate',
        action: 'keep',
        reason: 'deterministic_caption',
      });
      progress.completed++;
    } else {
      try {
        const caption = await generateSingleCaption(fullPath, model, maxRetries, !!options.noThink);
        results.set(asset.id, caption);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'keep',
          reason: 'vision_caption',
        });
        progress.completed++;
      } catch (error) {
        if (!isJsonMode()) {
          console.warn(`Failed to caption ${asset.fileName}:`, error);
        }
        verboseLog(`Failed to caption ${asset.fileName}: ${error}`);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'fallback',
          reason: 'caption_failed',
          details: { error: String(error) },
        });
        progress.failed++;
        totalFailures++;

        if (options.noFallback && totalFailures >= 5) {
          throw new VisionAbortError(`Aborting: ${totalFailures} total VLLM failures`, results);
        }
      }
    }

    reportProgress();
  });

  return results;
}

/**
 * Generate caption for single image
 */
async function generateSingleCaption(
  imagePath: string,
  model: string,
  maxRetries = 3,
  noThink = false
): Promise<string> {
  const ollama = getOllama();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const content = await ollama.chat({
        model,
        messages: [
          {
            role: 'user',
            content:
              'Describe this image in one detailed sentence. Be specific about what is visible.',
            images: [imagePath],
          },
        ],
        temperature: 0.5,
        think: !noThink,
      });

      const cleaned = extractFinalResponse(content || '');
      if (!cleaned) {
        throw new Error('Empty caption response');
      }
      return cleaned;
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) {
        throw error;
      }
      const delay = 2000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Failed to generate caption');
}

/**
 * Generate vision Q&A for images
 */
export async function generateVisionQA(
  assets: AssetRecord[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void,
  decisionLog?: TransformDecisionLog
): Promise<Map<string, { question: string; answer: string }[]>> {
  const results = new Map<string, { question: string; answer: string }[]>();
  const config = getConfig();
  const model = options.model || config.get('ollamaModel') || 'llava';
  const maxRetries = options.retries ?? 3;

  // Check if using cloud model - warn but continue
  if (isCloudModel(model)) {
    if (!isJsonMode()) {
      console.warn(
        chalk.yellow('\n⚠️  Using cloud model for vision: ') +
          chalk.cyan(model) +
          chalk.yellow(
            '\n   Make sure your Ollama server is configured to route to the cloud provider.'
          ) +
          chalk.gray('\n   Or use a local vision model: --model llava\n')
      );
    }
    verboseLog(`Using cloud model for vision: ${model}`);
  }

  const progress: VisionProgress = {
    total: assets.length,
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
  const queue = createOllamaQueue('vision', { abortSignal });

  const reportProgress = () => {
    if (!progressCb) return;
    const processed = progress.completed + progress.failed;
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = processed / elapsed || 1;
    const remaining = (progress.total - processed) / rate;

    progressCb({
      total: progress.total,
      completed: processed,
      stage: 'vision',
      message: `Generating vision Q&A: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''}`,
      estimatedTimeRemaining: Math.round(remaining),
    });
  };

  await queue.mapSettled(assets, async (asset) => {
    if (abortSignal.aborted) return;

    const baseDir = options.assetDir || path.dirname(options.input);
    const fullPath = path.resolve(baseDir, asset.localPath);
    if (process.env.NODE_ENV !== 'test') {
      try {
        await fs.access(fullPath);
      } catch {
        if (!isJsonMode()) {
          console.warn(
            `Image not found: ${fullPath}\n  Base directory: ${baseDir}\n  Asset localPath: ${asset.localPath}\n  Hint: If input is a directory, ensure assetDir matches the task folder.`
          );
        }
        verboseLog(
          `Image not found: ${fullPath} (baseDir=${baseDir}, localPath=${asset.localPath})`
        );
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'drop',
          reason: 'file_not_found',
          details: { fullPath, baseDir, localPath: asset.localPath },
        });
        progress.failed++;
        reportProgress();
        return;
      }
    }

    // Format pre-check: skip VLLM for unsupported formats on local models
    const unsupportedExtQA = checkUnsupportedFormat(asset, model);
    if (unsupportedExtQA) {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'generate',
        action: 'drop',
        reason: `unsupported_format: ${unsupportedExtQA}`,
        details: { fileName: asset.fileName, format: unsupportedExtQA },
      });
      progress.failed++;
      reportProgress();
      return;
    }

    if (options.noLlm) {
      results.set(asset.id, [
        {
          question: 'What is shown in this image?',
          answer:
            asset.context?.altText || `Image from ${asset.sourcePageTitle || 'unknown source'}`,
        },
      ]);
      decisionLog?.log({
        recordId: asset.id,
        stage: 'generate',
        action: 'keep',
        reason: 'deterministic_qa',
      });
      progress.completed++;
    } else {
      try {
        const qa = await generateSingleVisionQA(fullPath, model, maxRetries, !!options.noThink);
        results.set(asset.id, qa);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'keep',
          reason: 'vision_qa',
          details: { pairCount: qa.length },
        });
        progress.completed++;
      } catch (error) {
        if (!isJsonMode()) {
          console.warn(`Failed to generate QA for ${asset.fileName}:`, error);
        }
        verboseLog(`Failed to generate QA for ${asset.fileName}: ${error}`);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'fallback',
          reason: 'qa_generation_failed',
          details: { error: String(error) },
        });
        progress.failed++;
        totalFailures++;

        if (options.noFallback && totalFailures >= 5) {
          throw new VisionAbortError(`Aborting: ${totalFailures} total VLLM failures`, results);
        }
      }
    }

    reportProgress();
  });

  return results;
}

/**
 * Generate Q&A for single image
 */
async function generateSingleVisionQA(
  imagePath: string,
  model: string,
  maxRetries = 3,
  noThink = false
): Promise<{ question: string; answer: string }[]> {
  const ollama = getOllama();

  const jsonSchema = {
    type: 'object',
    properties: {
      qa_pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer: { type: 'string' },
          },
          required: ['question', 'answer'],
        },
      },
    },
    required: ['qa_pairs'],
  };

  const prompt = `Generate 2-3 question-answer pairs about this image.

Respond with JSON:
{
  "qa_pairs": [
    {"question": "...", "answer": "..."},
    {"question": "...", "answer": "..."}
  ]
}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let useFormat: object | undefined = jsonSchema;

      let content = await ollama.chat({
        model,
        messages: [{ role: 'user', content: prompt, images: [imagePath] }],
        temperature: 0.5,
        format: useFormat,
        think: !noThink,
      });

      content = extractFinalResponse(content);

      // If empty response (thinking model + format conflict), retry without format
      if (!content.trim()) {
        useFormat = undefined;
        content = await ollama.chat({
          model,
          messages: [{ role: 'user', content: prompt, images: [imagePath] }],
          temperature: 0.5,
          think: !noThink,
        });
        content = extractFinalResponse(content);
      }

      const parsed = tryParseJson(content) as Record<string, unknown> | null;
      if (!parsed) {
        throw new Error('Failed to parse JSON from response');
      }

      if (parsed.qa_pairs && Array.isArray(parsed.qa_pairs)) {
        return (parsed.qa_pairs as { question: string; answer: string }[]).map((qa) => ({
          question: qa.question,
          answer: qa.answer,
        }));
      }

      throw new Error('Invalid response format');
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) {
        throw error;
      }
      const delay = 2000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Failed to generate vision QA');
}

/**
 * Detect objects in images using VLLM (vision model via Ollama)
 * Returns bounding boxes as percentage-based coordinates, converted to absolute pixels
 */
export async function detectObjects(
  assets: AssetRecord[],
  options: TransformOptions,
  progressCb?: (progress: TransformProgress) => void,
  decisionLog?: TransformDecisionLog
): Promise<Map<string, ObjectDetection>> {
  const results = new Map<string, ObjectDetection>();
  const config = getConfig();
  const model = options.model || config.get('ollamaModel') || 'llava';
  const maxRetries = options.retries ?? 3;

  const progress: VisionProgress = {
    total: assets.length,
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
  const queue = createOllamaQueue('vision', { abortSignal });

  await queue.mapSettled(assets, async (asset) => {
    if (abortSignal.aborted) return;

    const baseDir = options.assetDir || path.dirname(options.input);
    const fullPath = path.resolve(baseDir, asset.localPath);

    if (process.env.NODE_ENV !== 'test') {
      try {
        await fs.access(fullPath);
      } catch {
        if (!isJsonMode()) {
          console.warn(
            `Image not found: ${fullPath}\n  Base directory: ${baseDir}\n  Asset localPath: ${asset.localPath}\n  Hint: If input is a directory, ensure assetDir matches the task folder.`
          );
        }
        verboseLog(
          `Image not found: ${fullPath} (baseDir=${baseDir}, localPath=${asset.localPath})`
        );
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'drop',
          reason: 'file_not_found',
          details: { fullPath, baseDir, localPath: asset.localPath },
        });
        progress.failed++;
        reportDetectionProgress(progress, progressCb);
        return;
      }
    }

    // Format pre-check: skip VLLM for unsupported formats on local models
    const unsupportedExtDet = checkUnsupportedFormat(asset, model);
    if (unsupportedExtDet) {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'generate',
        action: 'drop',
        reason: `unsupported_format: ${unsupportedExtDet}`,
        details: { fileName: asset.fileName, format: unsupportedExtDet },
      });
      progress.failed++;
      reportDetectionProgress(progress, progressCb);
      return;
    }

    if (options.noLlm) {
      let dims = { width: 640, height: 480 };
      try {
        dims = await getImageDimensions(fullPath);
      } catch {
        // Use defaults
      }
      const label = inferLabelFromPath(asset.localPath, options.target || 'object');
      results.set(asset.id, {
        objects: [{ label, bbox: [0, 0, dims.width, dims.height], confidence: 0.5 }],
        image_width: dims.width,
        image_height: dims.height,
      });
      decisionLog?.log({
        recordId: asset.id,
        stage: 'generate',
        action: 'keep',
        reason: 'deterministic_detection',
        details: { label },
      });
      progress.completed++;
    } else {
      try {
        const detection = await detectSingleImage(fullPath, model, maxRetries, !!options.noThink);
        results.set(asset.id, detection);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'keep',
          reason: 'vision_detection',
          details: { objectCount: detection.objects.length },
        });
        progress.completed++;
      } catch (error) {
        if (!isJsonMode()) {
          console.warn(`Failed to detect objects in ${asset.fileName}:`, error);
        }
        verboseLog(`Failed to detect objects in ${asset.fileName}: ${error}`);
        decisionLog?.log({
          recordId: asset.id,
          stage: 'generate',
          action: 'fallback',
          reason: 'detection_failed',
          details: { error: String(error) },
        });
        progress.failed++;
        totalFailures++;

        if (options.noFallback && totalFailures >= 5) {
          throw new VisionAbortError(`Aborting: ${totalFailures} total VLLM failures`, results);
        }
      }
    }

    reportDetectionProgress(progress, progressCb);
  });

  return results;
}

/**
 * Report detection progress
 */
function reportDetectionProgress(
  progress: VisionProgress,
  progressCb?: (progress: TransformProgress) => void
): void {
  if (!progressCb) return;
  const processed = progress.completed + progress.failed;
  const elapsed = (Date.now() - progress.startTime) / 1000;
  const rate = processed / elapsed || 1;
  const remaining = (progress.total - processed) / rate;

  progressCb({
    total: progress.total,
    completed: processed,
    stage: 'vision',
    message: `Detecting objects: ${processed}/${progress.total}${progress.failed > 0 ? ` (${progress.failed} failed)` : ''}`,
    estimatedTimeRemaining: Math.round(remaining),
  });
}

/**
 * Detect objects in a single image using VLLM
 */
async function detectSingleImage(
  imagePath: string,
  model: string,
  maxRetries = 3,
  noThink = false
): Promise<ObjectDetection> {
  const ollama = getOllama();

  // Get image dimensions for percentage → pixel conversion
  let dims = { width: 640, height: 480 };
  try {
    dims = await getImageDimensions(imagePath);
  } catch {
    // Use defaults
  }

  const jsonSchema = {
    type: 'object',
    properties: {
      objects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            x_pct: { type: 'number' },
            y_pct: { type: 'number' },
            w_pct: { type: 'number' },
            h_pct: { type: 'number' },
            confidence: { type: 'number' },
          },
          required: ['label', 'x_pct', 'y_pct', 'w_pct', 'h_pct', 'confidence'],
        },
      },
    },
    required: ['objects'],
  };

  const prompt = `Detect all objects in this image. For each object, estimate its bounding box as percentages of image dimensions.

Respond ONLY with JSON:
{
  "objects": [
    {"label": "object name", "x_pct": 10.0, "y_pct": 20.0, "w_pct": 30.0, "h_pct": 40.0, "confidence": 0.9}
  ]
}

x_pct/y_pct = top-left corner as % of image width/height (0-100)
w_pct/h_pct = width/height as % of image width/height (0-100)
confidence = 0.0-1.0`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let useFormat: object | undefined = jsonSchema;

      let content = await ollama.chat({
        model,
        messages: [{ role: 'user', content: prompt, images: [imagePath] }],
        temperature: 0.3,
        format: useFormat,
        think: !noThink,
      });

      content = extractFinalResponse(content);

      if (!content.trim()) {
        useFormat = undefined;
        content = await ollama.chat({
          model,
          messages: [{ role: 'user', content: prompt, images: [imagePath] }],
          temperature: 0.3,
          think: !noThink,
        });
        content = extractFinalResponse(content);
      }

      const parsed = tryParseJson(content) as Record<string, unknown> | null;
      if (!parsed || !Array.isArray(parsed.objects)) {
        throw new Error('Failed to parse detection JSON from response');
      }

      const objects = (parsed.objects as Array<Record<string, unknown>>).map((obj) => {
        const xPct = Number(obj.x_pct || 0);
        const yPct = Number(obj.y_pct || 0);
        const wPct = Number(obj.w_pct || 0);
        const hPct = Number(obj.h_pct || 0);

        return {
          label: String(obj.label || 'unknown'),
          bbox: [
            Math.round((xPct / 100) * dims.width),
            Math.round((yPct / 100) * dims.height),
            Math.round((wPct / 100) * dims.width),
            Math.round((hPct / 100) * dims.height),
          ] as [number, number, number, number],
          confidence: Math.max(0, Math.min(1, Number(obj.confidence || 0.5))),
        };
      });

      return {
        objects,
        image_width: dims.width,
        image_height: dims.height,
      };
    } catch (error) {
      if (error instanceof ModelNotFoundError) throw error;
      if (attempt >= maxRetries) throw error;
      const delay = 2000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error('Failed to detect objects');
}

/**
 * Infer label from file path
 */
function inferLabelFromPath(filePath: string, target: string): string {
  const normalized = filePath.toLowerCase();

  // Check for common patterns
  if (normalized.includes('car') || normalized.includes('auto') || normalized.includes('vehicle')) {
    return 'vehicle';
  }
  if (
    normalized.includes('person') ||
    normalized.includes('people') ||
    normalized.includes('face')
  ) {
    return 'person';
  }
  if (normalized.includes('animal') || normalized.includes('pet')) {
    return 'animal';
  }
  if (normalized.includes('food') || normalized.includes('meal')) {
    return 'food';
  }
  if (normalized.includes('building') || normalized.includes('architecture')) {
    return 'architecture';
  }
  if (normalized.includes('nature') || normalized.includes('landscape')) {
    return 'nature';
  }

  // Extract from directory name
  const dirName = path.basename(path.dirname(normalized));
  if (dirName && dirName !== 'downloads' && dirName !== 'images') {
    return dirName.replace(/[-_]/g, ' ');
  }

  return target || 'unknown';
}
