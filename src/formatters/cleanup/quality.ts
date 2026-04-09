/**
 * Quality scoring utilities for data cleanup
 * Content length checks, LLM-based quality rating, and filtering
 */

import type { QualityScore } from '../types';
import { getFieldValue } from '../utils';

/**
 * Quality metrics for a record
 */
export interface QualityMetrics {
  /** Content length score (0-10) */
  lengthScore: number;
  /** Readability score (0-10) - based on sentence structure */
  readabilityScore: number;
  /** Diversity score (0-10) - based on vocabulary diversity */
  diversityScore: number;
  /** Format score (0-10) - checks for proper formatting */
  formatScore: number;
  /** Overall score (0-10) - weighted average */
  overall: number;
  /** Reason for the score */
  reason: string;
}

/**
 * Score records by content length
 * Records outside min/max range get reduced scores
 * @param data - Array of records
 * @param field - Field to score
 * @param minLength - Minimum acceptable length
 * @param maxLength - Maximum acceptable length
 * @returns Records with _quality score attached
 */
export function scoreByLength<T extends Record<string, unknown>>(
  data: T[],
  field: string,
  minLength?: number,
  maxLength?: number
): Array<T & { _quality: QualityScore }> {
  return data.map((record, index) => {
    const value = getFieldValue(record, field);
    const text = String(value || '');
    const length = text.length;

    let score = 10;
    const reasons: string[] = [];

    // Check minimum length
    if (minLength !== undefined && length < minLength) {
      score = Math.max(1, Math.round((length / minLength) * 5));
      reasons.push(`Length ${length} below minimum ${minLength}`);
    }

    // Check maximum length
    if (maxLength !== undefined && length > maxLength) {
      score = Math.min(score, 5);
      reasons.push(`Length ${length} exceeds maximum ${maxLength}`);
    }

    // Bonus for optimal length (between min and max, or just reasonable length)
    if (reasons.length === 0) {
      if (length > 100 && length < 10000) {
        score = 10;
        reasons.push('Optimal length');
      } else if (length < 50) {
        score = 6;
        reasons.push('Very short content');
      } else if (length > 50000) {
        score = 7;
        reasons.push('Very long content');
      }
    }

    return {
      ...record,
      _quality: {
        index,
        score,
        reason: reasons.join('; ') || 'Good length',
      },
    };
  });
}

/**
 * Calculate comprehensive quality metrics for text
 * @param text - Text to analyze
 * @returns Quality metrics
 */
export function calculateQualityMetrics(text: string): QualityMetrics {
  const length = text.length;

  // Length score
  let lengthScore = 10;
  if (length < 50) lengthScore = 3;
  else if (length < 100) lengthScore = 5;
  else if (length < 200) lengthScore = 7;
  else if (length > 10000) lengthScore = 6;
  else if (length > 50000) lengthScore = 4;

  // Readability score (based on sentence structure)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgSentenceLength = sentences.length > 0 ? length / sentences.length : 0;
  let readabilityScore = 10;
  if (avgSentenceLength < 10) readabilityScore = 4;
  else if (avgSentenceLength > 50) readabilityScore = 5;
  else if (sentences.length === 0) readabilityScore = 2;

  // Diversity score (vocabulary diversity)
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  const uniqueWords = new Set(words);
  const diversity = words.length > 0 ? uniqueWords.size / words.length : 0;
  let diversityScore = Math.round(diversity * 20); // Scale to 0-10
  diversityScore = Math.max(1, Math.min(10, diversityScore));

  // Format score (checks for proper structure)
  let formatScore = 10;
  if (text.includes('\n\n\n\n')) formatScore -= 2; // Excessive blank lines
  if (/[^\x20-\x7E\s\u00A0-\u024F]/u.test(text)) formatScore -= 1; // Unusual characters
  if (text.includes('  ')) formatScore -= 1; // Double spaces
  if (sentences.length > 0 && !text.match(/[.!?]$/)) formatScore -= 1; // No ending punctuation
  formatScore = Math.max(1, formatScore);

  // Calculate overall score (weighted average)
  const overall = Math.round(
    lengthScore * 0.3 + readabilityScore * 0.25 + diversityScore * 0.25 + formatScore * 0.2
  );

  // Generate reason
  const reasons: string[] = [];
  if (lengthScore < 7) reasons.push(`Length: ${lengthScore}/10`);
  if (readabilityScore < 7) reasons.push(`Readability: ${readabilityScore}/10`);
  if (diversityScore < 7) reasons.push(`Diversity: ${diversityScore}/10`);
  if (formatScore < 7) reasons.push(`Format: ${formatScore}/10`);

  return {
    lengthScore,
    readabilityScore,
    diversityScore,
    formatScore,
    overall,
    reason: reasons.length > 0 ? reasons.join(', ') : 'Good quality content',
  };
}

/**
 * Score records by comprehensive quality metrics
 * @param data - Array of records
 * @param field - Field containing text to score
 * @returns Records with _quality score attached
 */
export function scoreByMetrics<T extends Record<string, unknown>>(
  data: T[],
  field: string
): Array<T & { _quality: QualityScore }> {
  return data.map((record, index) => {
    const value = getFieldValue(record, field);
    const text = String(value || '');

    const metrics = calculateQualityMetrics(text);

    return {
      ...record,
      _quality: {
        index,
        score: metrics.overall,
        reason: metrics.reason,
      },
    };
  });
}

/**
 * Score records using LLM for quality assessment
 * Uses async batch processing for efficiency
 * @param data - Array of records
 * @param field - Field containing text to score
 * @param config - LLM configuration
 * @param threshold - Optional threshold to stop early for low-quality items
 * @returns Records with _quality score attached
 */
export async function scoreByLLM<T extends Record<string, unknown>>(
  data: T[],
  field: string,
  config: {
    model: string;
    apiUrl: string;
    apiKey?: string;
    batchSize?: number;
    maxConcurrency?: number;
  },
  threshold?: number
): Promise<Array<T & { _quality: QualityScore }>> {
  const batchSize = config.batchSize || 10;
  const maxConcurrency = config.maxConcurrency || 5;

  console.log(`Starting LLM quality scoring for ${data.length} records with model ${config.model}`);

  const results: Array<T & { _quality: QualityScore }> = [];

  // Process in batches with concurrency control
  for (let i = 0; i < data.length; i += batchSize * maxConcurrency) {
    const batchPromises: Promise<Array<T & { _quality: QualityScore }>>[] = [];

    for (let j = 0; j < maxConcurrency && i + j * batchSize < data.length; j++) {
      const start = i + j * batchSize;
      const end = Math.min(start + batchSize, data.length);
      const batch = data.slice(start, end);

      batchPromises.push(scoreBatchByLLM(batch, field, start, config));
    }

    const batchResults = await Promise.all(batchPromises);
    for (const batchResult of batchResults) {
      results.push(...batchResult);
    }

    console.log(
      `Scored ${Math.min(i + batchSize * maxConcurrency, data.length)}/${data.length} records`
    );
  }

  return results;
}

/**
 * Score a batch of records using LLM
 * @param batch - Batch of records
 * @param field - Field containing text
 * @param startIndex - Starting index for error reporting
 * @param config - LLM configuration
 * @returns Scored records
 */
async function scoreBatchByLLM<T extends Record<string, unknown>>(
  batch: T[],
  field: string,
  startIndex: number,
  config: {
    model: string;
    apiUrl: string;
    apiKey?: string;
  }
): Promise<Array<T & { _quality: QualityScore }>> {
  const results: Array<T & { _quality: QualityScore }> = [];

  for (let i = 0; i < batch.length; i++) {
    const record = batch[i];
    const text = String(getFieldValue(record, field) || '');

    try {
      const score = await callLLMForQualityScore(text, config);
      results.push({
        ...record,
        _quality: {
          index: startIndex + i,
          score: score.score,
          reason: score.reason,
        },
      });
    } catch (error) {
      console.warn(`LLM scoring failed for record ${startIndex + i}: ${error}`);
      // Assign neutral score on failure
      results.push({
        ...record,
        _quality: {
          index: startIndex + i,
          score: 5,
          reason: 'LLM scoring failed',
        },
      });
    }
  }

  return results;
}

/**
 * Call LLM API to get quality score
 * @param text - Text to evaluate
 * @param config - LLM configuration
 * @returns Quality score and reason
 */
async function callLLMForQualityScore(
  text: string,
  config: {
    model: string;
    apiUrl: string;
    apiKey?: string;
  }
): Promise<{ score: number; reason: string }> {
  const prompt = `Rate the quality of the following content on a scale of 1-10.

Content:
"""
${text.slice(0, 2000)}${text.length > 2000 ? '\n...(truncated)' : ''}
"""

Provide your response in this exact JSON format:
{
  "score": <number 1-10>,
  "reason": "<brief explanation of the score>"
}

Consider: clarity, coherence, usefulness, accuracy, and overall value.`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // Detect if this is an Ollama endpoint
  const isOllama = config.apiUrl.includes('ollama');

  const body = isOllama
    ? JSON.stringify({
        model: config.model,
        prompt: prompt,
        stream: false,
      })
    : JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as {
    response?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };

  // Parse response (handle different API formats)
  let content: string;
  if (result.response) {
    // Ollama format
    content = result.response;
  } else if (result.choices?.[0]?.message?.content) {
    // OpenAI format
    content = result.choices[0].message.content;
  } else {
    throw new Error('Unexpected LLM response format');
  }

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(1, Math.min(10, Math.round(parsed.score))),
        reason: parsed.reason || 'No reason provided',
      };
    } catch {
      // Fallback: try to extract score with regex
      const scoreMatch = content.match(/score["\s:]+(\d+)/i);
      if (scoreMatch) {
        return {
          score: Math.max(1, Math.min(10, parseInt(scoreMatch[1], 10))),
          reason: 'Score extracted from text',
        };
      }
    }
  }

  return { score: 5, reason: 'Could not parse LLM response' };
}

/**
 * Filter records by quality score threshold
 * @param data - Records with _quality scores
 * @param threshold - Minimum quality score (1-10)
 * @returns Records meeting the threshold
 */
export function filterByScore<T extends { _quality: QualityScore }>(
  data: T[],
  threshold: number
): T[] {
  return data.filter((record) => record._quality.score >= threshold);
}

/**
 * Sort records by quality score (highest first)
 * @param data - Records with _quality scores
 * @returns Sorted records
 */
export function sortByQuality<T extends { _quality: QualityScore }>(data: T[]): T[] {
  return [...data].sort((a, b) => b._quality.score - a._quality.score);
}

/**
 * Get top N records by quality
 * @param data - Records with _quality scores
 * @param n - Number of records to return
 * @returns Top N records
 */
export function getTopQuality<T extends { _quality: QualityScore }>(data: T[], n: number): T[] {
  return sortByQuality(data).slice(0, n);
}

/**
 * Get quality distribution statistics
 * @param data - Records with _quality scores
 * @returns Distribution by score range
 */
export function getQualityDistribution<T extends { _quality: QualityScore }>(
  data: T[]
): Record<string, number> {
  const distribution: Record<string, number> = {
    '1-3 (Low)': 0,
    '4-5 (Below Average)': 0,
    '6-7 (Average)': 0,
    '8-9 (Good)': 0,
    '10 (Excellent)': 0,
  };

  for (const record of data) {
    const score = record._quality.score;
    if (score <= 3) distribution['1-3 (Low)']++;
    else if (score <= 5) distribution['4-5 (Below Average)']++;
    else if (score <= 7) distribution['6-7 (Average)']++;
    else if (score <= 9) distribution['8-9 (Good)']++;
    else distribution['10 (Excellent)']++;
  }

  return distribution;
}

/**
 * Remove quality scores from records (clean up metadata)
 * @param data - Records with _quality scores
 * @returns Records without _quality field
 */
export function stripQualityScores<T extends { _quality: QualityScore }>(
  data: T[]
): Omit<T, '_quality'>[] {
  return data.map(({ _quality, ...rest }) => rest as Omit<T, '_quality'>);
}

/**
 * Combine multiple quality scores into a single score
 * @param scores - Array of quality scores
 * @param weights - Optional weights for each score
 * @returns Combined score
 */
export function combineQualityScores(scores: QualityScore[], weights?: number[]): QualityScore {
  if (scores.length === 0) {
    return { index: -1, score: 0, reason: 'No scores' };
  }

  const effectiveWeights = weights || scores.map(() => 1 / scores.length);

  let totalWeight = 0;
  let weightedSum = 0;

  for (let i = 0; i < scores.length; i++) {
    const weight = effectiveWeights[i] || 0;
    totalWeight += weight;
    weightedSum += scores[i].score * weight;
  }

  const combinedScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  return {
    index: scores[0].index,
    score: Math.max(1, Math.min(10, combinedScore)),
    reason: `Combined from ${scores.length} scores`,
  };
}
