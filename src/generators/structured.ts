/**
 * Structured output generation with JSON schema validation and retry logic
 */

import { getOllama, OllamaClient, GenerateOptions } from './ollama';
import { verboseLog, logger } from '../utils/logger';
import type { GenerationProgress } from './tui';

export interface StructuredOptions {
  prompt: string;
  schema: object;
  model?: string;
  systemPrompt?: string;
  maxRetries?: number;
  temperature?: number;
}

export interface StructuredResult {
  data: unknown;
  raw: string;
  success: boolean;
  attempts: number;
  error?: string;
  duration?: number; // Response time in ms
  repairAttempted?: boolean;
  repairSuccess?: boolean;
}

export interface GenerationMetrics {
  targetCount: number;
  successCount: number;
  failedCount: number;
  totalDuration: number;
  averageResponseTime: number;
  errorsByType: Record<string, number>;
  repairAttempts: number;
  repairSuccesses: number;
  results: StructuredResult[];
}

/**
 * Generate structured output using LLM with schema validation
 * Uses Ollama's native structured output API
 */
export async function generateStructured(options: StructuredOptions): Promise<StructuredResult> {
  const client = getOllama();
  const maxRetries = options.maxRetries ?? 3;
  const startTime = Date.now();

  // Use Ollama's native format parameter for structured output
  const systemPrompt =
    options.systemPrompt ||
    `You are a JSON generator. Always respond with valid JSON matching the provided schema.`;

  verboseLog(`Starting structured generation with max ${maxRetries} retries`);
  verboseLog(`Schema: ${JSON.stringify(options.schema, null, 2)}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now();
    verboseLog(`Attempt ${attempt}/${maxRetries}: Generating structured output...`);

    try {
      const response = await client.generate({
        model: options.model,
        prompt: options.prompt,
        system: systemPrompt,
        temperature: options.temperature ?? 0.3,
        format: options.schema, // Native structured output API
      });

      const attemptDuration = Date.now() - attemptStart;
      verboseLog(`Attempt ${attempt}: Response received in ${attemptDuration}ms`);

      // With native format, response should already be valid JSON
      const raw = response.response.trim();
      verboseLog(`Attempt ${attempt}: Raw response length: ${raw.length} chars`);

      let data: unknown;
      let parsed = false;
      let parseError: string | undefined;

      try {
        data = JSON.parse(raw);
        parsed = true;
        verboseLog(`Attempt ${attempt}: JSON parsed successfully`);
      } catch (error) {
        parseError = (error as Error).message;
        verboseLog(`Attempt ${attempt}: JSON parse failed: ${parseError}`);
        verboseLog(`Attempt ${attempt}: Raw response preview:\n${raw.substring(0, 500)}`);

        // Fallback: try to extract and repair JSON
        const parseResult = parseJsonResponse(raw, options.schema, options.model);
        data = parseResult.data;
        if (parseResult.repairAttempted) {
          verboseLog(`Attempt ${attempt}: JSON repair was attempted`);
          if (parseResult.repairSuccess) {
            verboseLog(`Attempt ${attempt}: JSON repair succeeded`);
          } else {
            verboseLog(`Attempt ${attempt}: JSON repair failed: ${parseResult.repairError}`);
          }
        }
      }

      if (data) {
        // Validate against schema
        const validationResult = validateAgainstSchemaWithDetails(data, options.schema);
        if (validationResult.valid) {
          verboseLog(`Attempt ${attempt}: Schema validation passed`);
          return {
            data,
            raw,
            success: true,
            attempts: attempt,
            duration: Date.now() - startTime,
            repairAttempted: parseError !== undefined,
            repairSuccess: parseError !== undefined && data !== null,
          };
        } else {
          verboseLog(`Attempt ${attempt}: Schema validation failed: ${validationResult.error}`);
        }
      }

      logger.warn(`Attempt ${attempt}: Invalid JSON structure, retrying...`);
    } catch (error: any) {
      const attemptDuration = Date.now() - attemptStart;
      verboseLog(`Attempt ${attempt}: Error after ${attemptDuration}ms: ${error.message}`);
      logger.warn(`Attempt ${attempt}: ${error.message}, retrying...`);
    }

    // Wait before retry
    if (attempt < maxRetries) {
      const delay = 1000 * attempt;
      verboseLog(`Waiting ${delay}ms before retry...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const totalDuration = Date.now() - startTime;
  verboseLog(`All ${maxRetries} attempts failed after ${totalDuration}ms`);

  return {
    data: null,
    raw: '',
    success: false,
    attempts: maxRetries,
    error: 'Failed to generate valid JSON after maximum retries',
    duration: totalDuration,
    repairAttempted: false,
    repairSuccess: false,
  };
}

/**
 * Auto-generate JSON schema from a description using LLM
 */
export async function generateSchemaFromDescription(
  description: string,
  model?: string
): Promise<object> {
  const client = getOllama();

  const prompt = `Generate a JSON schema for the following description:
"${description}"

Return ONLY a valid JSON schema object with:
- "type": "object" as the root type
- "properties" with appropriate field names and types (string, number, integer, boolean, array, object)
- "required" array listing all required field names
- Optional: "description" fields for each property

Example output:
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "The name" },
    "age": { "type": "integer", "description": "The age in years" }
  },
  "required": ["name", "age"]
}

Your response should be ONLY the JSON schema, no other text.`;

  const response = await client.generate({
    model,
    prompt,
    temperature: 0.3,
  });

  const raw = response.response.trim();

  // Try to parse the response as JSON
  try {
    // Remove any markdown code blocks if present
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw;
    const schema = JSON.parse(jsonStr);

    // Validate it's a valid schema object
    if (typeof schema !== 'object' || schema === null) {
      throw new Error('Generated schema is not a valid object');
    }

    // Ensure type is set
    if (!schema.type) {
      schema.type = 'object';
    }

    return schema;
  } catch (error) {
    throw new Error(`Failed to generate valid schema: ${(error as Error).message}`);
  }
}

interface ParseJsonResult {
  data: unknown | null;
  repairAttempted: boolean;
  repairSuccess: boolean;
  repairError?: string;
}

/** Parse and validate JSON response with repair strategies */
function parseJsonResponse(raw: string, schema: object, model?: string): ParseJsonResult {
  verboseLog('Attempting to parse JSON response...');

  // Try to extract JSON from response
  let jsonStr = raw.trim();

  // Handle responses that might have markdown code blocks
  if (jsonStr.startsWith('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonStr = match[1].trim();
      verboseLog('Extracted JSON from markdown code block');
    }
  }

  // Try direct parsing first
  try {
    const json = JSON.parse(jsonStr);
    verboseLog('Direct JSON parsing succeeded');
    return { data: json, repairAttempted: false, repairSuccess: false };
  } catch (error) {
    verboseLog(`Direct JSON parsing failed: ${(error as Error).message}`);
  }

  // Attempt deterministic repairs
  verboseLog('Attempting deterministic JSON repairs...');
  const repaired = attemptDeterministicRepairs(jsonStr);
  if (repaired) {
    verboseLog('Deterministic repair succeeded');
    return { data: repaired, repairAttempted: true, repairSuccess: true };
  }

  // Attempt LLM-based repair as last resort
  verboseLog('Deterministic repair failed, attempting LLM-based repair...');
  return attemptLLMRepair(jsonStr, model);
}

/** Attempt deterministic JSON repairs */
function attemptDeterministicRepairs(jsonStr: string): unknown | null {
  verboseLog('Running deterministic repairs: trailing commas, quotes, brackets...');

  let repaired = jsonStr;

  // Fix 1: Remove trailing commas before } or ]
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // Fix 2: Normalize quotes (replace curly quotes with straight quotes)
  repaired = repaired.replace(/[\u201C\u201D]/g, '"');
  repaired = repaired.replace(/[\u2018\u2019]/g, "'");

  // Fix 3: Unescape newlines that might be double-escaped
  repaired = repaired.replace(/\\n/g, '\n');
  repaired = repaired.replace(/\\\"/g, '"');

  // Fix 4: Balance brackets
  repaired = balanceJson(repaired);

  // Fix 5: Remove comments (// style and /* */ style)
  repaired = repaired.replace(/\/\/.*$/gm, '');
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

  // Try parsing after repairs
  try {
    return JSON.parse(repaired);
  } catch {
    verboseLog('Deterministic repairs did not produce valid JSON');
    return null;
  }
}

/** Attempt LLM-based JSON repair */
function attemptLLMRepair(brokenJson: string, model?: string): ParseJsonResult {
  // Return immediately without attempting LLM repair
  // This avoids the circular dependency and keeps repair synchronous
  verboseLog('LLM repair skipped - would require async repair');
  return {
    data: null,
    repairAttempted: true,
    repairSuccess: false,
    repairError: 'LLM repair not available in sync context',
  };
}

/** Async LLM repair function for use when async is available */
export async function repairJsonWithLLM(
  brokenJson: string,
  model?: string
): Promise<unknown | null> {
  const client = getOllama();

  const repairPrompt = `The following text is supposed to be valid JSON but has errors.
Please repair it and return ONLY the valid JSON, with no explanations or markdown formatting.

Broken JSON:
\`\`\`
${brokenJson}
\`\`\`

Requirements:
1. Return ONLY valid JSON
2. Fix any syntax errors (trailing commas, missing quotes, etc.)
3. Ensure all strings use double quotes
4. Ensure the JSON is complete and properly closed
5. Do not add any explanatory text before or after the JSON`;

  try {
    verboseLog('Sending repair request to LLM...');
    const response = await client.generate({
      model,
      prompt: repairPrompt,
      temperature: 0.1, // Low temperature for more deterministic output
    });

    const raw = response.response.trim();
    verboseLog(`LLM repair response received, length: ${raw.length} chars`);

    // Extract JSON from repair response
    let repairedJson = raw;
    if (raw.startsWith('```')) {
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        repairedJson = match[1].trim();
      }
    }

    // Try to parse the repaired JSON
    const repaired = JSON.parse(repairedJson);
    verboseLog('LLM repair produced valid JSON');
    return repaired;
  } catch (error: any) {
    verboseLog(`LLM repair failed: ${error.message}`);
    return null;
  }
}

/** Attempt to balance JSON string */
function balanceJson(str: string): string {
  let open = 0;
  let close = 0;

  for (const char of str) {
    if (char === '{' || char === '[') open++;
    if (char === '}' || char === ']') close++;
  }

  if (open > close) {
    const missing = open - close;
    return str + '}'.repeat(missing);
  }

  return str;
}

/** Minimal JSON Schema shape used for validation */
interface JsonSchemaLike {
  type?: string;
  required?: string[];
  properties?: Record<string, object>;
  items?: object;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Schema validation with detailed error messages */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateAgainstSchemaWithDetails(data: any, schema: object): ValidationResult {
  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }

  const schemaObj = schema as JsonSchemaLike;

  // Check type
  if (schemaObj.type) {
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (actualType !== schemaObj.type) {
      if (!(schemaObj.type === 'object' && actualType === 'object')) {
        return {
          valid: false,
          error: `Type mismatch: expected ${schemaObj.type}, got ${actualType}`,
        };
      }
    }
  }

  // Check required fields
  if (schemaObj.required && Array.isArray(schemaObj.required)) {
    for (const field of schemaObj.required) {
      if (!(field in data)) {
        return {
          valid: false,
          error: `Missing required field: ${field}`,
        };
      }
    }
  }

  // Check properties
  if (schemaObj.properties && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, propSchema] of Object.entries(schemaObj.properties)) {
      if (key in data) {
        const propResult = validateAgainstSchemaWithDetails(data[key], propSchema as object);
        if (!propResult.valid) {
          return {
            valid: false,
            error: `Property '${key}': ${propResult.error}`,
          };
        }
      }
    }
  }

  // Check items (for arrays)
  if (schemaObj.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const itemResult = validateAgainstSchemaWithDetails(data[i], schemaObj.items);
      if (!itemResult.valid) {
        return {
          valid: false,
          error: `Array item [${i}]: ${itemResult.error}`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Generate multiple structured outputs with comprehensive metrics
 */
export async function generateStructuredBatch(
  options: StructuredOptions,
  count: number,
  onProgress?: (progress: GenerationProgress) => void
): Promise<{ results: StructuredResult[]; metrics: GenerationMetrics }> {
  const startTime = Date.now();
  const results: StructuredResult[] = [];
  const errorsByType: Record<string, number> = {};
  let repairAttempts = 0;
  let repairSuccesses = 0;
  let totalResponseTime = 0;

  logger.info(`Starting batch generation of ${count} records...`);

  for (let i = 0; i < count; i++) {
    verboseLog(`Generating record ${i + 1}/${count}...`);

    // Report progress before starting generation
    if (onProgress) {
      onProgress({
        current: i,
        total: count,
        status: 'generating',
        startTime,
        estimatedTimeRemaining: calculateETA(i, count, startTime),
      });
    }

    const result = await generateStructured(options);
    results.push(result);

    // Track metrics
    if (result.duration) {
      totalResponseTime += result.duration;
    }
    if (result.repairAttempted) {
      repairAttempts++;
      if (result.repairSuccess) {
        repairSuccesses++;
      }
    }
    if (result.error) {
      // Categorize error
      const errorType = categorizeError(result.error);
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
    }

    // Report progress after generation
    if (onProgress) {
      const status: GenerationProgress['status'] = result.success
        ? result.repairAttempted
          ? 'repairing'
          : 'completed'
        : result.attempts > 1
          ? 'retrying'
          : 'failed';

      onProgress({
        current: i + 1,
        total: count,
        status,
        currentAttempt: result.attempts,
        maxRetries: options.maxRetries ?? 3,
        startTime,
        estimatedTimeRemaining: calculateETA(i + 1, count, startTime),
      });
    }

    // Show progress in verbose mode
    if ((i + 1) % 10 === 0 || i === count - 1) {
      const successSoFar = results.filter((r) => r.success).length;
      verboseLog(`Progress: ${i + 1}/${count} (${successSoFar} successful)`);
    }

    // Small delay between requests
    if (i < count - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;
  const failedCount = count - successCount;
  const averageResponseTime = successCount > 0 ? totalResponseTime / successCount : 0;

  const metrics: GenerationMetrics = {
    targetCount: count,
    successCount,
    failedCount,
    totalDuration,
    averageResponseTime,
    errorsByType,
    repairAttempts,
    repairSuccesses,
    results,
  };

  return { results, metrics };
}

/** Calculate ETA based on average time per record */
function calculateETA(current: number, total: number, startTime: number): number {
  if (current === 0 || current >= total) {
    return 0;
  }
  const elapsed = Date.now() - startTime;
  const avgTimePerRecord = elapsed / current;
  const remaining = total - current;
  return avgTimePerRecord * remaining;
}

/** Categorize error messages for metrics */
function categorizeError(error: string): string {
  const lowerError = error.toLowerCase();
  if (lowerError.includes('schema validation')) return 'Schema Validation';
  if (lowerError.includes('json')) return 'JSON Parse';
  if (lowerError.includes('request failed')) return 'Request Failed';
  if (lowerError.includes('timeout')) return 'Timeout';
  if (lowerError.includes('connection')) return 'Connection';
  return 'Other';
}
