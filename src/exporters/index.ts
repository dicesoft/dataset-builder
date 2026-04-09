import fs from 'fs/promises';
import path from 'path';
import { safeJsonParse, safeJsonlParse } from '../utils/json';

export interface ExportOptions {
  inputPath: string;
  outputPath: string;
  format: string;
  pretty?: boolean;
  flatten?: boolean;
}

export async function exportDataset(options: ExportOptions): Promise<void> {
  const { inputPath, outputPath, format, pretty = false, flatten = false } = options;

  // Read input file
  const content = await fs.readFile(inputPath, 'utf-8');

  // Parse data
  let data: unknown[];
  if (content.trim().startsWith('[')) {
    data = safeJsonParse(content, 'export input file') as unknown[];
  } else {
    // JSONL format
    data = safeJsonlParse(content, 'export input file');
  }

  // Flatten if requested
  if (flatten) {
    data = data.map((item) => flattenObject(item as Record<string, unknown>));
  }

  // Format output
  let outputContent: string;
  switch (format) {
    case 'jsonl':
      outputContent = data.map((item) => JSON.stringify(item)).join('\n');
      break;
    case 'csv':
      outputContent = toCSV(data);
      break;
    case 'json':
    default:
      outputContent = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  }

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Write output
  await fs.writeFile(outputPath, outputContent, 'utf-8');
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

function toCSV(data: unknown[]): string {
  if (data.length === 0) return '';

  // Extract all unique keys
  const keys = new Set<string>();
  data.forEach((item) => {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item as object).forEach((k) => keys.add(k));
    }
  });

  const headers = Array.from(keys);

  // Generate rows
  const rows = data.map((item) => {
    return headers
      .map((h) => {
        const value = (item as Record<string, unknown>)[h];
        const str = value === undefined || value === null ? '' : String(value);
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
