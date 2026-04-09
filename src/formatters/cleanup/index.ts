/**
 * Data cleanup pipeline - Phase 2 Implementation
 * Orchestrates deduplication, validation, quality scoring, and filtering
 */

import type { CleanupOptions, QualityScore, ValidationResult } from '../types';
import { dedupeExact, dedupeByUrl, findDuplicateGroups } from './dedupe';
import {
  validateRequiredFields,
  validateTypes,
  validateFileReferences,
  validateEmails,
  validateUrls,
  validateDates,
  validateRanges,
  validateWithZod,
  validateAndTransform,
  createSchemaFromTypeMap,
} from './validate';
import { scoreByLength, scoreByLLM, filterByScore, sortByQuality } from './quality';
import { filterByCriteria, removeEmptyValues, balanceByField, sampleRandom } from './filter';

export interface CleanupResult {
  data: unknown[];
  stats: CleanupStats;
}

export interface CleanupStats {
  /** Total records at start */
  input: number;
  /** Total records at end */
  output: number;
  /** Records removed */
  removed: number;
  /** Records modified */
  modified: number;
  /** Records with quality scores added */
  scored: number;
  /** Breakdown by stage */
  stages: StageStats;
}

export interface StageStats {
  dedupe: { removed: number; reason: string };
  validate: { removed: number; errors: ValidationResult['errors'] };
  quality: { removed: number; belowThreshold: number };
  filter: { removed: number; reason: string };
}

export interface CleanupProgress {
  stage: string;
  processed: number;
  total: number;
  removed: number;
}

export type CleanupProgressCallback = (progress: CleanupProgress) => void;

/**
 * Run the full cleanup pipeline on data
 * Pipeline: dedupe → validate → quality → filter
 * @param data - Array of records to clean
 * @param options - Cleanup options
 * @param onProgress - Optional progress callback
 * @returns Cleanup result with cleaned data and statistics
 */
export async function runCleanup(
  data: unknown[],
  options?: CleanupOptions,
  onProgress?: CleanupProgressCallback
): Promise<CleanupResult> {
  const stats: CleanupStats = {
    input: data.length,
    output: data.length,
    removed: 0,
    modified: 0,
    scored: 0,
    stages: {
      dedupe: { removed: 0, reason: '' },
      validate: { removed: 0, errors: [] },
      quality: { removed: 0, belowThreshold: 0 },
      filter: { removed: 0, reason: '' },
    },
  };

  let workingData = [...data];

  console.log(`Starting cleanup pipeline with ${data.length} records`);

  // Stage 1: Deduplication
  if (options?.dedupe) {
    console.log('Running deduplication...');
    const beforeCount = workingData.length;

    if (options.dedupeFields?.includes('url')) {
      // URL-based deduplication
      const urlField = options.dedupeFields.find((f) => f.includes('url')) || 'url';
      workingData = dedupeByUrl(workingData, urlField);
    } else if (options.dedupeFields && options.dedupeFields.length > 0) {
      // Field-specific deduplication
      workingData = dedupeExact(workingData, options.dedupeFields);
    } else {
      // Full record deduplication
      workingData = dedupeExact(workingData);
    }

    const removed = beforeCount - workingData.length;
    stats.stages.dedupe = {
      removed,
      reason: options.dedupeFields
        ? `Duplicate ${options.dedupeFields.join(', ')}`
        : 'Duplicate records',
    };
    stats.removed += removed;

    console.log(`Deduplication: removed ${removed} records`);
    onProgress?.({ stage: 'dedupe', processed: beforeCount, total: beforeCount, removed });
  }

  // Stage 2: Validation
  if (options?.validate && options.requiredFields && options.requiredFields.length > 0) {
    console.log('Running validation...');
    const beforeCount = workingData.length;

    // Validate required fields
    const validation = validateRequiredFields(workingData, options.requiredFields, {
      allowEmptyStrings: false,
      trimStrings: true,
    });

    if (!validation.valid) {
      // Filter out invalid records
      const invalidIndices = new Set(validation.errors.map((e) => e.index));
      workingData = workingData.filter((_, i) => !invalidIndices.has(i));

      const removed = beforeCount - workingData.length;
      stats.stages.validate = {
        removed,
        errors: validation.errors.slice(0, 100), // Limit stored errors
      };
      stats.removed += removed;

      console.warn(`Validation: removed ${removed} invalid records`);
      if (removed > 0) {
        console.log(
          `Sample errors: ${validation.errors
            .slice(0, 3)
            .map((e) => e.message)
            .join('; ')}`
        );
      }
    }

    onProgress?.({
      stage: 'validate',
      processed: beforeCount,
      total: beforeCount,
      removed: stats.stages.validate.removed,
    });
  }

  // Stage 3: File reference validation
  if (options?.validateFileFields && options.validateFileFields.length > 0) {
    console.log('Validating file references...');
    const beforeCount = workingData.length;

    const fileValidation = await validateFileReferences(
      workingData,
      options.validateFileFields,
      options.basePath
    );

    if (!fileValidation.valid) {
      const invalidIndices = new Set(fileValidation.errors.map((e) => e.index));
      workingData = workingData.filter((_, i) => !invalidIndices.has(i));

      const removed = beforeCount - workingData.length;
      stats.stages.validate.removed += removed;
      stats.removed += removed;

      console.warn(`File validation: removed ${removed} records with missing files`);
    }

    onProgress?.({
      stage: 'validate-files',
      processed: beforeCount,
      total: beforeCount,
      removed: beforeCount - workingData.length,
    });
  }

  // Stage 4: Quality scoring
  if (options?.quality) {
    console.log('Running quality scoring...');
    const beforeCount = workingData.length;

    // Score by length if min/max length specified
    if (options.minLength || options.maxLength) {
      const contentField = findContentField(workingData);
      if (contentField) {
        workingData = scoreByLength(
          workingData as Record<string, unknown>[],
          contentField,
          options.minLength,
          options.maxLength
        ) as unknown[];
        stats.scored = workingData.length;
      }
    }

    // Filter by quality threshold
    if (options.qualityThreshold && stats.scored > 0) {
      const scoredData = workingData as Array<Record<string, unknown> & { _quality: QualityScore }>;
      const beforeFilter = scoredData.length;
      workingData = filterByScore(scoredData, options.qualityThreshold);

      const removed = beforeFilter - workingData.length;
      stats.stages.quality = {
        removed,
        belowThreshold: removed,
      };
      stats.removed += removed;

      console.log(
        `Quality filter: removed ${removed} records below threshold ${options.qualityThreshold}`
      );
    }

    onProgress?.({
      stage: 'quality',
      processed: beforeCount,
      total: beforeCount,
      removed: stats.stages.quality.removed,
    });
  }

  // Stage 5: Remove empty values
  if (options?.removeEmpty && options.requiredFields) {
    console.log('Removing records with empty values...');
    const beforeCount = workingData.length;

    workingData = removeEmptyValues(
      workingData as Record<string, unknown>[],
      options.requiredFields
    ) as unknown[];

    const removed = beforeCount - workingData.length;
    if (removed > 0) {
      stats.stages.filter.removed += removed;
      stats.stages.filter.reason = 'Empty values';
      stats.removed += removed;
      console.log(`Empty value filter: removed ${removed} records`);
    }

    onProgress?.({
      stage: 'filter-empty',
      processed: beforeCount,
      total: beforeCount,
      removed,
    });
  }

  // Update final stats
  stats.output = workingData.length;
  stats.modified = stats.scored;

  console.log(
    `Cleanup complete: ${stats.input} → ${stats.output} records (${stats.removed} removed)`
  );

  return {
    data: workingData,
    stats,
  };
}

/**
 * Run cleanup with LLM-based quality scoring
 * This is an advanced option that uses LLM to evaluate content quality
 * @param data - Array of records
 * @param options - Cleanup options
 * @param llmConfig - LLM configuration for quality scoring
 * @returns Cleanup result
 */
export async function runCleanupWithLLM(
  data: unknown[],
  options: CleanupOptions,
  llmConfig: {
    model: string;
    apiUrl: string;
    apiKey?: string;
    batchSize?: number;
  }
): Promise<CleanupResult> {
  const result = await runCleanup(data, { ...options, quality: false });
  let workingData = result.data;

  // Apply LLM-based quality scoring
  if (options.quality) {
    console.log('Running LLM quality scoring...');
    const contentField = findContentField(workingData);

    if (contentField) {
      try {
        workingData = await scoreByLLM(
          workingData as Record<string, unknown>[],
          contentField,
          llmConfig,
          options.qualityThreshold
        );

        // Filter by score
        if (options.qualityThreshold) {
          const scoredData = workingData as Array<
            Record<string, unknown> & { _quality: QualityScore }
          >;
          const beforeFilter = scoredData.length;
          workingData = filterByScore(scoredData, options.qualityThreshold);

          const removed = beforeFilter - workingData.length;
          result.stats.stages.quality.removed += removed;
          result.stats.removed += removed;
          result.stats.output = workingData.length;

          console.log(`LLM quality filter: removed ${removed} records`);
        }
      } catch (error) {
        console.warn(`LLM quality scoring failed: ${error}`);
        console.log('Continuing without LLM quality scoring');
      }
    }
  }

  return {
    data: workingData,
    stats: result.stats,
  };
}

/**
 * Find the most likely content field in the data
 * Searches for common field names like 'content', 'text', 'body', 'output', etc.
 * @param data - Array of records
 * @returns Field name or undefined
 */
function findContentField(data: unknown[]): string | undefined {
  if (data.length === 0) return undefined;

  const record = data[0] as Record<string, unknown>;
  const candidates = [
    'content',
    'text',
    'body',
    'output',
    'response',
    'answer',
    'description',
    'message',
  ];

  for (const field of candidates) {
    if (field in record && typeof record[field] === 'string') {
      return field;
    }
  }

  // Find first string field with substantial content
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > 50) {
      return key;
    }
  }

  return undefined;
}

/**
 * Get duplicate groups for reporting
 * @param data - Array of records
 * @param fields - Fields to compare
 * @returns Array of duplicate groups
 */
export function getDuplicateReport(
  data: unknown[],
  fields?: string[]
): Array<{ index: number; record: unknown }[]> {
  return findDuplicateGroups(data, fields);
}

/**
 * Validate data without modifying it
 * Returns detailed validation report
 * @param data - Array of records
 * @param options - Cleanup options
 * @returns Validation report
 */
export async function validateData(
  data: unknown[],
  options: Pick<CleanupOptions, 'requiredFields' | 'validateFileFields' | 'basePath'>
): Promise<{
  valid: boolean;
  summary: Record<string, number>;
  errors: ValidationResult['errors'];
  recommendations: string[];
}> {
  const errors: ValidationResult['errors'] = [];
  const summary: Record<string, number> = {
    total: data.length,
    valid: 0,
    invalid: 0,
    missingFields: 0,
    missingFiles: 0,
  };
  const recommendations: string[] = [];

  // Validate required fields
  if (options.requiredFields && options.requiredFields.length > 0) {
    const result = validateRequiredFields(data, options.requiredFields);
    errors.push(...result.errors);
    summary.valid = result.stats?.valid ?? 0;
    summary.invalid = result.stats?.invalid ?? 0;
    summary.missingFields = result.errors.length;

    if (summary.missingFields > 0) {
      recommendations.push(
        `Consider filling missing values in: ${options.requiredFields.join(', ')}`
      );
    }
  }

  // Validate file references
  if (options.validateFileFields && options.validateFileFields.length > 0) {
    const result = await validateFileReferences(data, options.validateFileFields, options.basePath);
    errors.push(...result.errors);
    summary.missingFiles = result.errors.length;

    if (summary.missingFiles > 0) {
      recommendations.push(`Check file paths in fields: ${options.validateFileFields.join(', ')}`);
    }
  }

  // Generate recommendations based on data analysis
  if (data.length > 0) {
    const record = data[0] as Record<string, unknown>;
    const fields = Object.keys(record);

    // Check for potential ID fields
    const idFields = fields.filter((f) => f.toLowerCase().includes('id'));
    if (idFields.length === 0) {
      recommendations.push('Consider adding an ID field for better deduplication');
    }

    // Check for URL fields
    const urlFields = fields.filter((f) => f.toLowerCase().includes('url'));
    if (urlFields.length > 0) {
      recommendations.push(
        `URL fields detected: ${urlFields.join(', ')} - enable URL deduplication`
      );
    }
  }

  return {
    valid: errors.length === 0,
    summary,
    errors: errors.slice(0, 100),
    recommendations,
  };
}

// Export all cleanup utilities
export * from './dedupe';
export * from './validate';
export * from './quality';
export * from './filter';
