/**
 * Math verification using mathjs for expression parsing and validation
 */

import { create, all, MathNode } from 'mathjs';

const math = create(all);

export interface MathVerificationResult {
  expression: string;
  isValid: boolean;
  evaluated?: number;
  error?: string;
}

/**
 * Verify mathematical expressions in text
 */
export function verifyMath(text: string): MathVerificationResult[] {
  const results: MathVerificationResult[] = [];

  // Extract math expressions from text
  const expressions = extractMathExpressions(text);

  for (const expr of expressions) {
    const result = verifyExpression(expr);
    results.push(result);
  }

  return results;
}

/**
 * Extract mathematical expressions from text
 */
export function extractMathExpressions(text: string): string[] {
  const expressions: string[] = [];

  // Common patterns: 2+2=4, 5 * 10 = 50, sqrt(16) = 4
  const patterns = [
    /(\d+\.?\d*\s*[\+\-\*\/\^\%\√\∛\√\]\(\)]\s*)+(\d+\.?\d*)\s*=\s*(\d+\.?\d*)/g,
    /(sqrt|sin|cos|tan|log|ln|exp|pow|abs|ceil|floor|round)\s*\([^)]+\)/gi,
    /(\d+\.?\d*)\s*([=<>])\s*(\d+\.?\d*)/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Extract left side of equality
        const eqMatch = match.match(/^(.+?)\s*=\s*(.+)$/);
        if (eqMatch) {
          expressions.push(eqMatch[1].trim());
        } else {
          expressions.push(match.trim());
        }
      }
    }
  }

  return [...new Set(expressions)];
}

/**
 * Verify a single mathematical expression
 */
export function verifyExpression(expression: string): MathVerificationResult {
  try {
    // Parse the expression
    const node = math.parse(expression);

    // Simplify and evaluate
    const simplified = math.simplify(node);
    const result = simplified.evaluate();

    // Handle complex numbers - convert to real if possible
    let evaluated: number;
    if (typeof result === 'number') {
      evaluated = result;
    } else if (typeof result === 'object' && 're' in result) {
      evaluated = (result as any).re;
    } else {
      return {
        expression,
        isValid: false,
        error: 'Complex result, cannot verify',
      };
    }

    return {
      expression,
      isValid: true,
      evaluated: Math.round(evaluated * 1000000) / 1000000, // Round to 6 decimal places
    };
  } catch (error: any) {
    return {
      expression,
      isValid: false,
      error: error.message || 'Invalid expression',
    };
  }
}

/**
 * Check if text contains verifiable math
 */
export function hasMathExpressions(text: string): boolean {
  return extractMathExpressions(text).length > 0;
}

/**
 * Batch verify multiple texts
 */
export function verifyMathBatch(texts: string[]): Map<string, MathVerificationResult[]> {
  const results = new Map<string, MathVerificationResult[]>();

  for (const text of texts) {
    results.set(text, verifyMath(text));
  }

  return results;
}
