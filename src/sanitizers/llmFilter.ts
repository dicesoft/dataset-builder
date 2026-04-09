/**
 * LLM-based text filtering (profanity, hallucinations, relevance)
 */

import { getOllama, OllamaClient } from '../generators/ollama';
import { createOllamaQueue } from '../utils/concurrency';

export interface FilterOptions {
  strictness?: 'low' | 'medium' | 'high';
  target?: string;
  batchSize?: number;
  onProgress?: (completed: number, total: number) => void;
}

export interface FilterResult {
  text: string;
  passed: boolean;
  reasons: string[];
  scores: {
    profanity: number;
    relevance: number;
    hallucination: number;
  };
}

/**
 * Filter texts using LLM
 */
export async function filterText(
  text: string,
  options: FilterOptions = {},
  client?: OllamaClient
): Promise<FilterResult> {
  const ollamaClient = client ?? getOllama();
  const strictness = options.strictness || 'medium';

  const prompt = buildFilterPrompt(text, options.target, strictness);

  try {
    const response = await ollamaClient.generate({
      prompt,
      temperature: 0.1,
    });

    return parseFilterResponse(text, response.response, strictness);
  } catch (error) {
    return {
      text,
      passed: true, // Fail open
      reasons: ['Filter error: ' + (error as any).message],
      scores: { profanity: 0, relevance: 0, hallucination: 0 },
    };
  }
}

/** Build filter prompt */
function buildFilterPrompt(text: string, target?: string, strictness?: string): string {
  const targetStr = target ? `Target topic: ${target}\n` : '';

  return `Analyze the following text for:
1. Profanity/inappropriate content (0-1 score)
2. Relevance to: ${target || 'general purpose'} (0-1 score)
3. Potential hallucination/factual errors (0-1 score)

${targetStr}
Text to analyze:
"""
${text}
"""

Respond with JSON only (no other text):
{
  "profanity": <0-1>,
  "relevance": <0-1>,
  "hallucination": <0-1>,
  "passed": <true/false>,
  "reasons": ["reason1", "reason2"]
}

Strictness level: ${strictness}`;
}

/** Parse LLM filter response */
function parseFilterResponse(text: string, response: string, strictness: string): FilterResult {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        text,
        passed: true,
        reasons: ['Could not parse filter response'],
        scores: { profanity: 0, relevance: 0, hallucination: 0 },
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Adjust threshold based on strictness
    const threshold = strictness === 'high' ? 0.7 : strictness === 'low' ? 0.3 : 0.5;
    const passed =
      parsed.passed !== false &&
      parsed.profanity < threshold &&
      parsed.relevance >= threshold * 0.5;

    return {
      text,
      passed,
      reasons: parsed.reasons || [],
      scores: {
        profanity: parsed.profanity || 0,
        relevance: parsed.relevance || 0,
        hallucination: parsed.hallucination || 0,
      },
    };
  } catch {
    return {
      text,
      passed: true,
      reasons: ['Parse error - fail open'],
      scores: { profanity: 0, relevance: 0, hallucination: 0 },
    };
  }
}

/**
 * Filter batch of texts
 */
export async function filterTexts(
  texts: string[],
  options: FilterOptions = {}
): Promise<FilterResult[]> {
  const queue = createOllamaQueue('text');
  let completed = 0;

  const settled = await queue.mapSettled(texts, async (text) => {
    const result = await filterText(text, options);
    completed++;
    if (options.onProgress) {
      options.onProgress(completed, texts.length);
    }
    return result;
  });

  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          text: texts[i],
          passed: true,
          reasons: ['Filter error - fail open'],
          scores: { profanity: 0, relevance: 0, hallucination: 0 },
        }
  );
}

/**
 * Check for profanity only (simple local version)
 */
export function containsProfanity(text: string): boolean {
  const profanityList = [
    'fuck',
    'shit',
    'damn',
    'bitch',
    'ass',
    'bastard',
    'crap',
    'dick',
    'piss',
    // Add more as needed
  ];

  const lower = text.toLowerCase();
  return profanityList.some((word) => lower.includes(word));
}
