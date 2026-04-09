/**
 * Filter utilities for data cleanup
 * Remove records by criteria, sample randomly, balance datasets
 */

import type { QualityScore } from '../types';
import { getFieldValue } from '../utils';

/**
 * Filter criteria for record selection
 */
export interface FilterCriteria {
  /** Field must equal this value */
  equals?: unknown;
  /** Field must contain this string (case-insensitive) */
  contains?: string;
  /** Field must match this regex pattern */
  matches?: RegExp;
  /** Field must be greater than this value */
  greaterThan?: number;
  /** Field must be less than this value */
  lessThan?: number;
  /** Field must be in this array of values */
  in?: unknown[];
  /** Field must not be null/undefined */
  exists?: boolean;
}

/**
 * Complex filter expression
 * Supports AND/OR logic
 */
export type FilterExpression =
  | { and: FilterExpression[] }
  | { or: FilterExpression[] }
  | { not: FilterExpression }
  | { field: string; criteria: FilterCriteria };

/**
 * Filter records by criteria
 * @param data - Array of records
 * @param field - Field to filter on
 * @param criteria - Filter criteria
 * @returns Filtered records
 */
export function filterByCriteria<T extends Record<string, unknown>>(
  data: T[],
  field: string,
  criteria: FilterCriteria
): T[] {
  return data.filter((record) => {
    const value = getFieldValue(record, field);
    return matchesCriteria(value, criteria);
  });
}

/**
 * Filter records by complex expression
 * @param data - Array of records
 * @param expression - Filter expression
 * @returns Filtered records
 */
export function filterByExpression<T extends Record<string, unknown>>(
  data: T[],
  expression: FilterExpression
): T[] {
  return data.filter((record) => evaluateExpression(record, expression));
}

/**
 * Check if a value matches criteria
 * @param value - Value to check
 * @param criteria - Criteria to match
 * @returns True if matches
 */
function matchesCriteria(value: unknown, criteria: FilterCriteria): boolean {
  // Handle exists check first
  if (criteria.exists !== undefined) {
    const exists = value !== undefined && value !== null;
    if (exists !== criteria.exists) return false;
  }

  // If value is null/undefined and exists is not false, skip other checks
  if (value === undefined || value === null) {
    return criteria.exists === false;
  }

  // equals
  if (criteria.equals !== undefined) {
    if (value !== criteria.equals) return false;
  }

  // contains (string match)
  if (criteria.contains !== undefined) {
    const str = String(value).toLowerCase();
    if (!str.includes(criteria.contains.toLowerCase())) return false;
  }

  // matches (regex)
  if (criteria.matches !== undefined) {
    if (!criteria.matches.test(String(value))) return false;
  }

  // greaterThan
  if (criteria.greaterThan !== undefined) {
    const num = Number(value);
    if (isNaN(num) || num <= criteria.greaterThan) return false;
  }

  // lessThan
  if (criteria.lessThan !== undefined) {
    const num = Number(value);
    if (isNaN(num) || num >= criteria.lessThan) return false;
  }

  // in
  if (criteria.in !== undefined) {
    if (!criteria.in.includes(value)) return false;
  }

  return true;
}

/**
 * Evaluate a complex filter expression
 * @param record - Record to evaluate
 * @param expression - Filter expression
 * @returns True if record matches
 */
function evaluateExpression(
  record: Record<string, unknown>,
  expression: FilterExpression
): boolean {
  if ('and' in expression) {
    return expression.and.every((e) => evaluateExpression(record, e));
  }

  if ('or' in expression) {
    return expression.or.some((e) => evaluateExpression(record, e));
  }

  if ('not' in expression) {
    return !evaluateExpression(record, expression.not);
  }

  if ('field' in expression) {
    const value = getFieldValue(record, expression.field);
    return matchesCriteria(value, expression.criteria);
  }

  return true;
}

/**
 * Sample N records randomly
 * @param data - Array of records
 * @param n - Number of records to sample
 * @param seed - Optional random seed for reproducibility
 * @returns Sampled records
 */
export function sampleRandom<T>(data: T[], n: number, seed?: number): T[] {
  if (n >= data.length) return [...data];
  if (n <= 0) return [];

  // Create seeded random if provided
  let random: () => number;
  if (seed !== undefined) {
    // Simple seeded random using xorshift
    let state = seed >>> 0;
    random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) % 1000000) / 1000000;
    };
  } else {
    random = Math.random;
  }

  // Fisher-Yates shuffle and take first n
  const shuffled = [...data];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, n);
}

/**
 * Sample records stratified by a field
 * Maintains proportional representation
 * @param data - Array of records
 * @param field - Field to stratify by
 * @param n - Total number of records to sample
 * @param seed - Optional random seed
 * @returns Stratified sample
 */
export function sampleStratified<T extends Record<string, unknown>>(
  data: T[],
  field: string,
  n: number,
  seed?: number
): T[] {
  if (n >= data.length) return [...data];

  // Group by field value
  const groups = new Map<unknown, T[]>();
  for (const record of data) {
    const key = getFieldValue(record, field);
    const existing = groups.get(key) || [];
    existing.push(record);
    groups.set(key, existing);
  }

  // Calculate samples per group
  const numGroups = groups.size;
  const baseCount = Math.floor(n / numGroups);
  let remainder = n - baseCount * numGroups;

  // Sample from each group
  const result: T[] = [];
  for (const [, group] of groups) {
    const groupN = baseCount + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    result.push(...sampleRandom(group, Math.min(groupN, group.length), seed));
  }

  return result;
}

/**
 * Balance dataset by limiting records per field value
 * @param data - Array of records
 * @param field - Field to balance by
 * @param maxPerValue - Maximum records per unique value
 * @returns Balanced dataset
 */
export function balanceByField<T extends Record<string, unknown>>(
  data: T[],
  field: string,
  maxPerValue: number
): T[] {
  const counts = new Map<unknown, number>();
  const result: T[] = [];

  for (const record of data) {
    const key = getFieldValue(record, field);
    const currentCount = counts.get(key) || 0;

    if (currentCount < maxPerValue) {
      result.push(record);
      counts.set(key, currentCount + 1);
    }
  }

  return result;
}

/**
 * Remove records with empty/null values in specified fields
 * @param data - Array of records
 * @param fields - Fields to check
 * @returns Filtered records
 */
export function removeEmptyValues<T extends Record<string, unknown>>(
  data: T[],
  fields?: string[]
): T[] {
  if (!fields || fields.length === 0) {
    // Check all fields
    return data.filter((record) =>
      Object.values(record).some((v) => v !== undefined && v !== null && v !== '')
    );
  }

  return data.filter((record) =>
    fields.every((field) => {
      const value = getFieldValue(record, field);
      return value !== undefined && value !== null && value !== '';
    })
  );
}

/**
 * Filter records by quality score threshold
 * @param data - Records with _quality scores
 * @param threshold - Minimum quality score
 * @returns Filtered records
 */
export function filterByQuality<T extends { _quality: QualityScore }>(
  data: T[],
  threshold: number
): T[] {
  return data.filter((record) => record._quality.score >= threshold);
}

/**
 * Remove duplicate records based on a key field
 * Keeps the first occurrence
 * @param data - Array of records
 * @param keyField - Field to use as unique key
 * @returns Deduplicated records
 */
export function removeDuplicatesByKey<T extends Record<string, unknown>>(
  data: T[],
  keyField: string
): T[] {
  const seen = new Set<unknown>();
  const result: T[] = [];

  for (const record of data) {
    const key = getFieldValue(record, keyField);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(record);
    }
  }

  return result;
}
