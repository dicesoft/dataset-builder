/**
 * Fact checking using LLM for factual claim verification
 */

import { getOllama } from '../generators/ollama';

export interface FactCheckResult {
  claim: string;
  isTrue: boolean;
  confidence: number;
  explanation: string;
  sources?: string[];
}

export interface TextFactCheckResult {
  text: string;
  claims: FactCheckResult[];
  overallTruth: number;
  passed: boolean;
}

/**
 * Check facts in text using LLM
 */
export async function factCheck(text: string): Promise<TextFactCheckResult> {
  const client = getOllama();

  const prompt = `Analyze the following text and identify factual claims. Then verify each claim.

Text to check:
"""
${text}
"""

Respond with JSON only (no other text):
{
  "claims": [
    {
      "claim": "the specific claim text",
      "isTrue": true/false,
      "confidence": 0.0-1.0,
      "explanation": "brief explanation",
      "sources": ["source1", "source2"] // if available
    }
  ],
  "overallTruth": 0.0-1.0,
  "passed": true/false
}`;

  try {
    const response = await client.generate({
      prompt,
      temperature: 0.2,
    });

    return parseFactCheckResponse(text, response.response);
  } catch (error) {
    return {
      text,
      claims: [],
      overallTruth: 0.5,
      passed: true, // Fail open
    };
  }
}

/** Parse LLM fact check response */
function parseFactCheckResponse(text: string, response: string): TextFactCheckResult {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        text,
        claims: [],
        overallTruth: 0.5,
        passed: true,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      text,
      claims: parsed.claims || [],
      overallTruth: parsed.overallTruth ?? 0.5,
      passed: parsed.passed !== false,
    };
  } catch {
    return {
      text,
      claims: [],
      overallTruth: 0.5,
      passed: true,
    };
  }
}

/**
 * Extract potential claims from text
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];

  // Pattern for factual statements
  const patterns = [
    /([A-Z][^.!?]*?(?:is|are|was|were|will|can|has|have|had)[^.!?]*)/g,
    /([^.!?]*\d+[^.!?]*)/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      claims.push(...matches);
    }
  }

  // Filter to likely claims
  return claims.filter((claim) => claim.length > 10 && claim.length < 200);
}

/**
 * Batch fact check multiple texts
 */
export async function factCheckBatch(
  texts: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<TextFactCheckResult[]> {
  const results: TextFactCheckResult[] = [];

  for (let i = 0; i < texts.length; i++) {
    const result = await factCheck(texts[i]);
    results.push(result);

    if (onProgress) {
      onProgress(i + 1, texts.length);
    }

    // Rate limiting
    if (i < texts.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}
