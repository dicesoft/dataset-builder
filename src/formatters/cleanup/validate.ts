/**
 * Validation utilities for data cleanup
 * Schema validation, field checking, file reference validation
 */

import fs from 'fs/promises';
import path from 'path';
import type { ZodSchema, ZodError } from 'zod';
import type { ValidationResult, ValidationError } from '../types';
import { getFieldValue } from '../utils';

/**
 * Validate that required fields exist and are non-empty
 * @param data - Array of records
 * @param requiredFields - List of required field paths
 * @param options - Validation options
 * @returns Validation result
 */
export function validateRequiredFields(
  data: unknown[],
  requiredFields: string[],
  options: { allowEmptyStrings?: boolean; trimStrings?: boolean } = {}
): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;
  const { allowEmptyStrings = false, trimStrings = true } = options;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of requiredFields) {
      const value = getFieldValue(record, field);

      let isValid = value !== undefined && value !== null;

      if (isValid && typeof value === 'string') {
        const strValue = trimStrings ? value.trim() : value;
        isValid = allowEmptyStrings || strValue.length > 0;
      }

      if (!isValid) {
        errors.push({
          index: i,
          field,
          message: `Required field "${field}" is ${value === undefined ? 'undefined' : value === null ? 'null' : 'empty'}`,
          value,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate data types
 * @param data - Array of records
 * @param typeMap - Map of field -> expected type
 * @returns Validation result
 */
export function validateTypes(
  data: unknown[],
  typeMap: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'>
): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const [field, expectedType] of Object.entries(typeMap)) {
      const value = getFieldValue(record, field);

      if (value === undefined || value === null) continue; // Skip null/undefined

      let actualType: string = typeof value;
      if (Array.isArray(value)) actualType = 'array';
      else if (actualType === 'object') actualType = 'object';

      if (actualType !== expectedType) {
        errors.push({
          index: i,
          field,
          message: `Expected type "${expectedType}" but got "${actualType}"`,
          value,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate that file references exist on disk
 * @param data - Array of records
 * @param fileFields - Fields containing file paths
 * @param basePath - Base path for resolving relative paths
 * @returns Validation result
 */
export async function validateFileReferences(
  data: unknown[],
  fileFields: string[],
  basePath?: string
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of fileFields) {
      const filePath = getFieldValue(record, field) as string | undefined;

      if (!filePath) continue; // Skip if field is empty

      const fullPath = basePath ? path.resolve(basePath, filePath) : path.resolve(filePath);

      try {
        await fs.access(fullPath);
      } catch {
        errors.push({
          index: i,
          field,
          message: `File not found: ${filePath}`,
          value: filePath,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate email format
 * @param data - Array of records
 * @param emailFields - Fields containing email addresses
 * @returns Validation result
 */
export function validateEmails(data: unknown[], emailFields: string[]): ValidationResult {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of emailFields) {
      const value = getFieldValue(record, field);
      if (!value) continue;

      const email = String(value);
      if (!emailRegex.test(email)) {
        errors.push({
          index: i,
          field,
          message: `Invalid email format: ${email}`,
          value: email,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate URL format
 * @param data - Array of records
 * @param urlFields - Fields containing URLs
 * @returns Validation result
 */
export function validateUrls(data: unknown[], urlFields: string[]): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of urlFields) {
      const value = getFieldValue(record, field);
      if (!value) continue;

      const urlString = String(value);
      try {
        new URL(urlString);
      } catch {
        errors.push({
          index: i,
          field,
          message: `Invalid URL format: ${urlString}`,
          value: urlString,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate that dates are in correct format
 * @param data - Array of records
 * @param dateFields - Fields containing dates
 * @param format - Expected date format ('iso', 'timestamp', or 'any')
 * @returns Validation result
 */
export function validateDates(
  data: unknown[],
  dateFields: string[],
  format: 'iso' | 'timestamp' | 'any' = 'any'
): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const field of dateFields) {
      const value = getFieldValue(record, field);
      if (!value) continue;

      let isValid = false;

      if (format === 'timestamp') {
        isValid = typeof value === 'number' && !isNaN(value);
      } else if (format === 'iso') {
        const date = new Date(String(value));
        isValid = !isNaN(date.getTime());
      } else {
        // 'any' - try to parse as date
        const date = new Date(String(value));
        isValid = !isNaN(date.getTime());
      }

      if (!isValid) {
        errors.push({
          index: i,
          field,
          message: `Invalid date format (expected ${format}): ${value}`,
          value,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate numeric ranges
 * @param data - Array of records
 * @param rangeMap - Map of field -> { min, max }
 * @returns Validation result
 */
export function validateRanges(
  data: unknown[],
  rangeMap: Record<string, { min?: number; max?: number }>
): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i] as Record<string, unknown>;
    let recordValid = true;

    for (const [field, range] of Object.entries(rangeMap)) {
      const value = getFieldValue(record, field);
      if (value === undefined || value === null) continue;

      const num = Number(value);
      if (isNaN(num)) {
        errors.push({
          index: i,
          field,
          message: `Value is not a number: ${value}`,
          value,
        });
        recordValid = false;
        continue;
      }

      if (range.min !== undefined && num < range.min) {
        errors.push({
          index: i,
          field,
          message: `Value ${num} is below minimum ${range.min}`,
          value: num,
        });
        recordValid = false;
      }

      if (range.max !== undefined && num > range.max) {
        errors.push({
          index: i,
          field,
          message: `Value ${num} is above maximum ${range.max}`,
          value: num,
        });
        recordValid = false;
      }
    }

    if (recordValid) validCount++;
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Validate data against a Zod schema
 * @param data - Array of records to validate
 * @param schema - Zod schema to validate against
 * @returns Validation result with detailed errors
 */
export function validateWithZod<T>(data: unknown[], schema: ZodSchema<T>): ValidationResult {
  const errors: ValidationError[] = [];
  let validCount = 0;

  for (let i = 0; i < data.length; i++) {
    const record = data[i];
    const result = schema.safeParse(record);

    if (result.success) {
      validCount++;
    } else {
      const zodError = result.error as ZodError;
      for (const issue of zodError.issues) {
        errors.push({
          index: i,
          field: issue.path.join('.'),
          message: issue.message,
          value:
            issue.path.length > 0
              ? getFieldValue(record as Record<string, unknown>, issue.path.join('.'))
              : record,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      total: data.length,
      valid: validCount,
      invalid: data.length - validCount,
    },
  };
}

/**
 * Create a Zod schema from a type map for runtime validation
 * @param typeMap - Map of field names to types
 * @returns Zod object schema
 */
export function createSchemaFromTypeMap(
  typeMap: Record<
    string,
    'string' | 'number' | 'boolean' | 'array' | 'object' | 'date' | 'email' | 'url'
  >
): ZodSchema {
  // Dynamic import to avoid issues if Zod is not installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const z = require('zod');

  const shape: Record<string, unknown> = {};

  for (const [field, type] of Object.entries(typeMap)) {
    switch (type) {
      case 'string':
        shape[field] = z.string();
        break;
      case 'number':
        shape[field] = z.number();
        break;
      case 'boolean':
        shape[field] = z.boolean();
        break;
      case 'array':
        shape[field] = z.array(z.unknown());
        break;
      case 'object':
        shape[field] = z.record(z.unknown());
        break;
      case 'date':
        shape[field] = z.union([z.date(), z.string().datetime(), z.number()]);
        break;
      case 'email':
        shape[field] = z.string().email();
        break;
      case 'url':
        shape[field] = z.string().url();
        break;
      default:
        shape[field] = z.unknown();
    }
  }

  return z.object(shape).passthrough();
}

/**
 * Validate and transform data using Zod schema
 * @param data - Array of records
 * @param schema - Zod schema with transformations
 * @returns Object with valid data, errors, and transformed values
 */
export function validateAndTransform<T>(
  data: unknown[],
  schema: ZodSchema<T>
): {
  valid: boolean;
  data: T[];
  errors: ValidationError[];
  stats: { total: number; valid: number; invalid: number };
} {
  const errors: ValidationError[] = [];
  const validData: T[] = [];

  for (let i = 0; i < data.length; i++) {
    const record = data[i];
    const result = schema.safeParse(record);

    if (result.success) {
      validData.push(result.data);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const z = require('zod');
      const zodError = result.error as ZodError;
      for (const issue of zodError.issues) {
        errors.push({
          index: i,
          field: issue.path.join('.'),
          message: issue.message,
          value:
            issue.path.length > 0
              ? getFieldValue(record as Record<string, unknown>, issue.path.join('.'))
              : record,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    data: validData,
    errors,
    stats: {
      total: data.length,
      valid: validData.length,
      invalid: data.length - validData.length,
    },
  };
}
