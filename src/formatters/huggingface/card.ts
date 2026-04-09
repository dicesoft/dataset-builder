/**
 * Dataset card generator
 * Generates HuggingFace-compatible README.md with YAML frontmatter
 * Works with any formatter, not just HuggingFace ones
 */

import fs from 'fs/promises';
import path from 'path';
import { generateYAML, buildFeaturesMap } from './utils';
import type { FeatureType, FieldStats } from '../types';
import { ensureDir } from '../utils';

/**
 * Options for dataset card generation
 */
export interface DatasetCardOptions {
  /** Dataset name */
  datasetName: string;
  /** Dataset description */
  description?: string;
  /** License identifier (e.g., "mit", "apache-2.0") */
  license?: string;
  /** Task categories (e.g., ["text-generation", "question-answering"]) */
  taskCategories?: string[];
  /** Language codes (e.g., ["en"]) */
  language?: string[];
  /** Tags (e.g., ["alpaca", "instruction-tuning"]) */
  tags?: string[];
  /** Feature schema */
  features?: Record<string, FeatureType>;
  /** Split info */
  splits?: Array<{ name: string; numExamples: number; numBytes?: number }>;
  /** Total dataset size */
  totalExamples?: number;
  /** Formatter used */
  formatter?: string;
  /** Field-level statistics from computeStatistics() */
  fieldStats?: Record<string, FieldStats>;
  /** Custom sections to add */
  customSections?: Record<string, string>;
}

/**
 * Generate dataset card README.md content
 */
export function generateDatasetCard(options: DatasetCardOptions): string {
  const sections: string[] = [];

  // Build YAML frontmatter
  sections.push('---');
  sections.push(buildFrontmatter(options));
  sections.push('---');
  sections.push('');

  // Title
  sections.push(`# ${options.datasetName}`);
  sections.push('');

  // Description
  if (options.description) {
    sections.push('## Description');
    sections.push('');
    sections.push(options.description);
    sections.push('');
  }

  // Dataset Structure
  sections.push('## Dataset Structure');
  sections.push('');

  // Features table
  if (options.features && Object.keys(options.features).length > 0) {
    sections.push('### Features');
    sections.push('');
    sections.push('| Feature | Type |');
    sections.push('|---------|------|');
    for (const [name, type] of Object.entries(options.features)) {
      sections.push(`| ${name} | ${formatFeatureTypeDisplay(type)} |`);
    }
    sections.push('');
  }

  // Splits table
  if (options.splits && options.splits.length > 0) {
    sections.push('### Splits');
    sections.push('');
    sections.push('| Split | Examples |');
    sections.push('|-------|----------|');
    for (const split of options.splits) {
      sections.push(`| ${split.name} | ${split.numExamples.toLocaleString()} |`);
    }
    sections.push('');
  }

  // Statistics
  if (options.totalExamples) {
    sections.push('### Statistics');
    sections.push('');
    sections.push(`- **Total examples**: ${options.totalExamples.toLocaleString()}`);
    if (options.formatter) {
      sections.push(`- **Format**: ${options.formatter}`);
    }
    sections.push('');

    // Field-level statistics
    if (options.fieldStats && Object.keys(options.fieldStats).length > 0) {
      sections.push('### Field Statistics');
      sections.push('');
      sections.push('| Field | Type | Non-null | Avg Length | Min | Max |');
      sections.push('|-------|------|----------|-----------|-----|-----|');
      for (const [name, stats] of Object.entries(options.fieldStats)) {
        const avgLen = stats.avgLength !== undefined ? Math.round(stats.avgLength).toString() : '-';
        const min =
          stats.min !== undefined
            ? stats.min.toString()
            : stats.minLength !== undefined
              ? stats.minLength.toString()
              : '-';
        const max =
          stats.max !== undefined
            ? stats.max.toString()
            : stats.maxLength !== undefined
              ? stats.maxLength.toString()
              : '-';
        sections.push(
          `| ${name} | ${stats.type} | ${stats.nonNull} | ${avgLen} | ${min} | ${max} |`
        );
      }
      sections.push('');
    }
  }

  // Usage
  sections.push('## Usage');
  sections.push('');
  sections.push('```python');
  sections.push('from datasets import load_dataset');
  sections.push('');
  sections.push(`ds = load_dataset("${options.datasetName}")`);
  sections.push('print(ds)');
  sections.push('```');
  sections.push('');

  // Custom sections
  if (options.customSections) {
    for (const [title, content] of Object.entries(options.customSections)) {
      sections.push(`## ${title}`);
      sections.push('');
      sections.push(content);
      sections.push('');
    }
  }

  return sections.join('\n');
}

/**
 * Build YAML frontmatter content
 */
function buildFrontmatter(options: DatasetCardOptions): string {
  const meta: Record<string, unknown> = {};

  if (options.license) {
    meta.license = options.license;
  }

  if (options.taskCategories && options.taskCategories.length > 0) {
    meta.task_categories = options.taskCategories;
  }

  if (options.language && options.language.length > 0) {
    meta.language = options.language;
  }

  const tags = [...(options.tags || [])];
  if (options.formatter) {
    tags.push(options.formatter);
  }
  tags.push('dataset-builder');
  if (tags.length > 0) {
    meta.tags = tags;
  }

  meta.pretty_name = options.datasetName;

  // Size category
  if (options.totalExamples !== undefined) {
    meta.size_categories = [getSizeCategory(options.totalExamples)];
  }

  // Dataset info with features and splits
  if (options.features || options.splits) {
    const datasetInfo: Record<string, unknown> = {};

    if (options.features) {
      datasetInfo.features = buildFeaturesMap(options.features);
    }

    if (options.splits) {
      datasetInfo.splits = options.splits.map((s) => ({
        name: s.name,
        num_examples: s.numExamples,
        ...(s.numBytes !== undefined ? { num_bytes: s.numBytes } : {}),
      }));
    }

    meta.dataset_info = datasetInfo;
  }

  return generateYAML(meta);
}

/**
 * Get HuggingFace size category string
 */
function getSizeCategory(count: number): string {
  if (count < 1000) return 'n<1K';
  if (count < 10000) return '1K<n<10K';
  if (count < 100000) return '10K<n<100K';
  if (count < 1000000) return '100K<n<1M';
  if (count < 10000000) return '1M<n<10M';
  if (count < 100000000) return '10M<n<100M';
  if (count < 1000000000) return '100M<n<1B';
  return 'n>1B';
}

/**
 * Format FeatureType for display in markdown
 */
function formatFeatureTypeDisplay(ft: FeatureType): string {
  if (typeof ft === 'string') return ft;
  if (ft.type === 'list') return `list[${formatFeatureTypeDisplay(ft.feature)}]`;
  if (ft.type === 'dict') {
    const fields = Object.entries(ft.fields)
      .map(([k, v]) => `${k}: ${formatFeatureTypeDisplay(v)}`)
      .join(', ');
    return `{${fields}}`;
  }
  return 'unknown';
}

/**
 * Write dataset card to disk
 */
export async function writeDatasetCard(
  outputDir: string,
  options: DatasetCardOptions
): Promise<string> {
  await ensureDir(outputDir);
  const cardContent = generateDatasetCard(options);
  const cardPath = path.join(outputDir, 'README.md');
  await fs.writeFile(cardPath, cardContent, 'utf-8');
  return cardPath;
}
