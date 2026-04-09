/**
 * Search result validation - filters search results by relevance to the query
 * Supports deterministic (keyword overlap) and LLM-judge methods
 */

import type { SearchResult } from './search/types';
import { OllamaClient } from '../generators/ollama';
import { verboseLog } from '../utils/logger';

export type ValidateMethod = 'deterministic' | 'llm';

export interface ValidateOptions {
  method: ValidateMethod;
  threshold: number;
  query: string;
}

/** Common English stop words to exclude from keyword matching */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'it',
  'as',
  'be',
  'was',
  'were',
  'are',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'when',
  'where',
  'why',
  'not',
  'no',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'up',
  'out',
  'all',
  'some',
  'any',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'into',
]);

/**
 * Tokenize text: lowercase, split on non-alphanumeric, remove stop words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Compute keyword overlap score between query and a search result
 * Title matches are weighted 2x compared to snippet matches
 */
function computeOverlapScore(queryTokens: string[], title: string, snippet: string): number {
  if (queryTokens.length === 0) return 0;

  const titleTokens = new Set(tokenize(title));
  const snippetTokens = new Set(tokenize(snippet));

  let score = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      score += 2; // Title match weighted 2x
    } else if (snippetTokens.has(token)) {
      score += 1;
    }
  }

  // Normalize: max possible score is queryTokens.length * 2 (all in title)
  const maxScore = queryTokens.length * 2;
  return score / maxScore;
}

/**
 * Validate search results using deterministic keyword overlap
 */
function validateDeterministic(
  results: SearchResult[],
  query: string,
  threshold: number
): { passed: SearchResult[]; filtered: SearchResult[] } {
  const queryTokens = tokenize(query);
  const passed: SearchResult[] = [];
  const filtered: SearchResult[] = [];

  for (const result of results) {
    const score = computeOverlapScore(queryTokens, result.title, result.snippet);
    verboseLog(
      `  Validation score for "${result.title.substring(0, 40)}...": ${score.toFixed(3)} (threshold: ${threshold})`
    );

    if (score >= threshold) {
      passed.push(result);
    } else {
      filtered.push(result);
    }
  }

  return { passed, filtered };
}

/**
 * Validate search results using LLM judge (Ollama)
 * Falls back to deterministic if Ollama is unavailable
 */
async function validateWithLLM(
  results: SearchResult[],
  query: string,
  threshold: number
): Promise<{ passed: SearchResult[]; filtered: SearchResult[] }> {
  const ollama = new OllamaClient();

  // Check if Ollama is available
  const isAvailable = await ollama.ping();
  if (!isAvailable) {
    verboseLog('Ollama unavailable, falling back to deterministic validation');
    console.warn('Ollama is not running. Falling back to deterministic validation.');
    return validateDeterministic(results, query, Math.min(threshold, 0.3));
  }

  const passed: SearchResult[] = [];
  const filtered: SearchResult[] = [];

  for (const result of results) {
    try {
      const response = await ollama.generate({
        prompt: `Rate how relevant this search result is to the query on a scale from 0.0 to 1.0.\n\nQuery: "${query}"\nTitle: "${result.title}"\nSnippet: "${result.snippet}"\n\nRespond with ONLY a number between 0.0 and 1.0, nothing else.`,
        temperature: 0.1,
        num_predict: 10,
      });

      const scoreStr = response.response.trim();
      const score = parseFloat(scoreStr);

      if (isNaN(score)) {
        verboseLog(
          `  LLM returned non-numeric score for "${result.title.substring(0, 40)}...": ${scoreStr}, keeping result`
        );
        passed.push(result);
        continue;
      }

      const clampedScore = Math.max(0, Math.min(1, score));
      verboseLog(
        `  LLM relevance score for "${result.title.substring(0, 40)}...": ${clampedScore.toFixed(3)} (threshold: ${threshold})`
      );

      if (clampedScore >= threshold) {
        passed.push(result);
      } else {
        filtered.push(result);
      }
    } catch (error) {
      verboseLog(`  LLM validation error for "${result.title.substring(0, 40)}...": ${error}`);
      // On error, keep the result
      passed.push(result);
    }
  }

  return { passed, filtered };
}

/**
 * Validate search results by relevance to the query
 */
export async function validateSearchResults(
  results: SearchResult[],
  options: ValidateOptions
): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  verboseLog(
    `Validating ${results.length} search results (method: ${options.method}, threshold: ${options.threshold})`
  );

  let passed: SearchResult[];
  let filtered: SearchResult[];

  if (options.method === 'llm') {
    ({ passed, filtered } = await validateWithLLM(results, options.query, options.threshold));
  } else {
    ({ passed, filtered } = validateDeterministic(results, options.query, options.threshold));
  }

  if (filtered.length > 0) {
    console.log(
      `Validation: ${passed.length} relevant results kept, ${filtered.length} filtered out`
    );
    if (filtered.length > 0) {
      verboseLog('Filtered results:');
      for (const r of filtered) {
        verboseLog(`  - ${r.title.substring(0, 60)}`);
      }
    }
  } else {
    verboseLog('All results passed validation');
  }

  return passed;
}
