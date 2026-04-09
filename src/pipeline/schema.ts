/**
 * Zod schema for pipeline configuration validation
 * Covers the 6 supported step types: scrape, generate, import, clean, export, format
 */

import { z } from 'zod';

// --- Step option schemas ---

const scrapeOptionsSchema = z.object({
  url: z.string().describe('URL to scrape'),
  spider: z.string().default('basic').describe('Spider type to use'),
  output: z.enum(['json', 'jsonl', 'csv', 'xml']).default('json').describe('Output format'),
  depth: z.number().int().min(1).default(1).describe('Crawl depth'),
  settings: z.string().optional().describe('Custom Scrapy settings string'),
  engine: z.string().default('scrapy').describe('Scraping engine'),
});

const generateOptionsSchema = z.object({
  type: z.string().default('person').describe('Type of synthetic data to generate'),
  count: z.number().int().min(1).default(10).describe('Number of records to generate'),
  locale: z.string().default('en').describe('Locale for fake data generation'),
});

const importOptionsSchema = z.object({
  filePath: z.string().describe('Path to file to import'),
  type: z.string().optional().describe('File type override (csv, json, xml, etc.)'),
  encoding: z.string().default('utf-8').describe('File encoding'),
  delimiter: z.string().default(',').describe('CSV delimiter character'),
});

const cleanOptionsSchema = z.object({
  dedupe: z.boolean().default(false).describe('Remove duplicate records'),
  trim: z.boolean().default(true).describe('Trim whitespace from string values'),
  lowercase: z.boolean().default(false).describe('Convert string values to lowercase'),
  removeEmpty: z.boolean().default(true).describe('Remove empty/null records'),
  normalizeNewlines: z.boolean().default(true).describe('Normalize newline characters'),
});

const exportOptionsSchema = z.object({
  input: z.string().optional().describe('Input file path (uses pipeline data if omitted)'),
  output: z.string().describe('Output file path'),
  format: z.enum(['json', 'jsonl', 'csv']).default('json').describe('Export format'),
  pretty: z.boolean().default(false).describe('Pretty-print JSON output'),
  flatten: z.boolean().default(false).describe('Flatten nested objects'),
});

const formatOptionsSchema = z.object({
  input: z.string().optional().describe('Input file path (uses pipeline data if omitted)'),
  outputDir: z.string().describe('Output directory'),
  formatter: z.string().describe('Formatter name (alpaca, chatml, sharegpt, etc.)'),
  fieldMap: z
    .record(z.string(), z.string())
    .default({})
    .describe('Field mapping from source to target'),
  splitRatios: z
    .tuple([z.number(), z.number(), z.number()])
    .optional()
    .describe('Train/val/test split ratios'),
  seed: z.number().default(42).describe('Random seed for reproducible splits'),
  systemPrompt: z.string().optional().describe('System prompt for chat formats'),
  datasetName: z.string().optional().describe('Dataset name for metadata'),
});

// --- Pipeline step schema (discriminated union on "type") ---

export const pipelineStepSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().describe('Human-readable step name'),
    type: z.literal('scrape'),
    options: scrapeOptionsSchema,
  }),
  z.object({
    name: z.string().describe('Human-readable step name'),
    type: z.literal('generate'),
    options: generateOptionsSchema,
  }),
  z.object({
    name: z.string().describe('Human-readable step name'),
    type: z.literal('import'),
    options: importOptionsSchema,
  }),
  z.object({
    name: z.string().describe('Human-readable step name'),
    type: z.literal('clean'),
    options: cleanOptionsSchema,
  }),
  z.object({
    name: z.string().describe('Human-readable step name'),
    type: z.literal('export'),
    options: exportOptionsSchema,
  }),
  z.object({
    name: z.string().describe('Human-readable step name'),
    type: z.literal('format'),
    options: formatOptionsSchema,
  }),
]);

// --- Pipeline config schema ---

export const pipelineConfigSchema = z.object({
  name: z.string().describe('Pipeline name'),
  steps: z.array(pipelineStepSchema).min(1).describe('Ordered list of pipeline steps'),
});

export type PipelineConfigZod = z.infer<typeof pipelineConfigSchema>;
export type PipelineStepZod = z.infer<typeof pipelineStepSchema>;

// --- Individual option schema exports (for stdin validation) ---

export {
  scrapeOptionsSchema,
  generateOptionsSchema,
  importOptionsSchema,
  cleanOptionsSchema,
  exportOptionsSchema,
  formatOptionsSchema,
};
