/**
 * Vision-based image filtering using LLM for image analysis
 */

import { analyzeImage } from '../generators/vision-utils';
import { getConfig } from '../config';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { detectFileType } from '../downloader/fileHandler';
import type { ProgressTracker } from '../utils/tui';
import { createOllamaQueue } from '../utils/concurrency';

export interface VisionFilterOptions {
  sensitivity: number;
  target?: string;
  checkNSFW?: boolean;
  checkRelevance?: boolean;
  model?: string;
  prompt?: string;
  verbose?: boolean;
  tracker?: ProgressTracker;
}

export interface VisionFilterResult {
  file: string;
  passed: boolean;
  isNSFW: boolean;
  hasMinors: boolean;
  relevance?: number;
  confidence: number;
  reasons: string[];
}

/** Log a verbose line via tracker if available, otherwise console.log */
function verboseLog(options: VisionFilterOptions, line: string): void {
  if (options.tracker) {
    options.tracker.log(line);
  } else {
    console.log(line);
  }
}

/**
 * Filter images using vision capabilities
 * Note: This requires Ollama with vision model (llava, etc.)
 */
export async function filterImage(
  filePath: string,
  options: VisionFilterOptions
): Promise<VisionFilterResult> {
  // Check if file exists and is an image
  if (!fs.existsSync(filePath)) {
    return {
      file: filePath,
      passed: false,
      isNSFW: false,
      hasMinors: false,
      confidence: 0,
      reasons: ['File not found'],
    };
  }

  const fileType = detectFileType(filePath);
  if (fileType !== 'image') {
    return {
      file: filePath,
      passed: true,
      isNSFW: false,
      hasMinors: false,
      confidence: 0,
      reasons: ['Not an image file'],
    };
  }

  const prompt = options.prompt || buildVisionPrompt(options);

  if (options.verbose) {
    const config = getConfig();
    const effectiveModel =
      options.model || config.get('ollamaVisionModel') || config.get('ollamaModel') || 'llava';
    verboseLog(options, chalk.gray(`[vision] File: ${filePath}`));
    verboseLog(options, chalk.gray(`[vision] Model: ${effectiveModel}`));
    verboseLog(
      options,
      chalk.gray(`[vision] Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`)
    );
  }

  try {
    // Use analyzeImage from vision-utils (proven working Ollama chat API with images)
    const systemPrefix =
      'You are an image classifier. Analyze the image and respond with JSON only.\n\n';
    const response = await analyzeImage(filePath, systemPrefix + prompt, options.model);

    if (options.verbose) {
      verboseLog(
        options,
        chalk.gray(
          `[vision] Raw response: ${response.slice(0, 300)}${response.length > 300 ? '...' : ''}`
        )
      );
    }

    const result = parseVisionResponse(filePath, response, options);

    if (options.verbose) {
      const status = result.passed ? 'PASSED' : 'FAILED';
      verboseLog(
        options,
        chalk.gray(
          `[vision] Result: ${status} | NSFW: ${result.isNSFW ? 'yes' : 'no'} | Minors: ${result.hasMinors ? 'yes' : 'no'} | Relevance: ${result.relevance ?? 'N/A'} | Confidence: ${result.confidence}`
        )
      );
      if (result.reasons.length > 0) {
        verboseLog(options, chalk.gray(`[vision] Reasons: ${JSON.stringify(result.reasons)}`));
      }
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Model not found = configuration error, should fail loudly
    if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('pull')) {
      const config = getConfig();
      const modelName =
        options.model || config.get('ollamaVisionModel') || config.get('ollamaModel') || 'llava';
      throw new Error(
        `Vision model not available (model: "${modelName}"): ${msg}. Run 'ollama pull ${modelName}' to install it.`
      );
    }

    if (options.verbose) {
      verboseLog(options, chalk.gray(`[vision] Error: ${msg}`));
    }

    // Transient errors - pass with warning
    return {
      file: filePath,
      passed: true,
      isNSFW: false,
      hasMinors: false,
      confidence: 0,
      reasons: ['Vision analysis unavailable, passed by default'],
    };
  }
}

/** Build vision analysis prompt */
function buildVisionPrompt(options: VisionFilterOptions): string {
  const checks: string[] = [];

  if (options.checkNSFW !== false) {
    checks.push('- NSFW/inappropriate content');
    checks.push('- Minors (anyone under 18)');
  }
  if (options.checkRelevance && options.target) {
    checks.push(`- Relevance to: ${options.target}`);
  }

  return `Analyze this image for:
${checks.join('\n')}

Respond with JSON:
{
  "isNSFW": true/false,
  "hasMinors": true/false,
  "relevance": 0.0-1.0,
  "confidence": 0.0-1.0,
  "reasons": ["reason1", "reason2"],
  "passed": true/false
}

Sensitivity: ${options.sensitivity}`;
}

/** Parse vision response */
function parseVisionResponse(
  file: string,
  response: string,
  options: VisionFilterOptions
): VisionFilterResult {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        file,
        passed: true,
        isNSFW: false,
        hasMinors: false,
        confidence: 0,
        reasons: ['Could not parse response'],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const relevanceFailed =
      options.target &&
      parsed.relevance !== undefined &&
      parsed.relevance < (options.sensitivity || 0.5);
    const passed =
      parsed.passed !== false && !parsed.isNSFW && !parsed.hasMinors && !relevanceFailed;

    return {
      file,
      passed,
      isNSFW: parsed.isNSFW || false,
      hasMinors: parsed.hasMinors || false,
      relevance: parsed.relevance,
      confidence: parsed.confidence || 0.5,
      reasons: parsed.reasons || [],
    };
  } catch {
    return {
      file,
      passed: true,
      isNSFW: false,
      hasMinors: false,
      confidence: 0,
      reasons: ['Parse error - passed by default'],
    };
  }
}

/**
 * Filter multiple images
 */
export async function filterImages(
  filePaths: string[],
  options: VisionFilterOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<VisionFilterResult[]> {
  const queue = createOllamaQueue('vision');
  let completed = 0;

  const settled = await queue.mapSettled(filePaths, async (filePath) => {
    const result = await filterImage(filePath, options);
    completed++;
    if (onProgress) {
      onProgress(completed, filePaths.length);
    }
    return result;
  });

  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          file: filePaths[i],
          passed: true,
          isNSFW: false,
          hasMinors: false,
          confidence: 0,
          reasons: ['Vision analysis error, passed by default'],
        }
  );
}

/**
 * Filter all images in a directory
 */
export async function filterImageDirectory(
  dirPath: string,
  options: VisionFilterOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<VisionFilterResult[]> {
  const files = getImageFiles(dirPath);
  return filterImages(files, options, onProgress);
}

/** Get all image files in directory */
export function getImageFiles(dirPath: string): string[] {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const files: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (imageExtensions.includes(ext)) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  }

  return files;
}
