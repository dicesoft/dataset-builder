import fs from 'fs/promises';
import path from 'path';
import { importFile } from '../importers/index';
import { exportDataset } from '../exporters/index';
import { cleanData } from '../sanitizers/index';
import { runScrapy, ScrapyOptions } from '../scrapy/runner';
import { generateSyntheticData } from '../generators/faker';
import { formatDataset } from '../formatters/index';
import type { ExtendedFormatOptions } from '../formatters/index';
import { pipelineConfigSchema } from './schema';
import { isJsonMode } from '../utils/output';

export interface PipelineConfig {
  name: string;
  steps: PipelineStep[];
}

export interface PipelineStep {
  name: string;
  type: 'scrape' | 'generate' | 'import' | 'clean' | 'export' | 'format';
  options: Record<string, unknown>;
}

export interface PipelineResult {
  success: boolean;
  stepsCompleted: number;
  error?: string;
}

/**
 * Validate a pipeline config without executing it.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export async function validatePipelineConfig(
  configPath: string
): Promise<{ valid: boolean; errors?: string[] }> {
  const configContent = await fs.readFile(configPath, 'utf-8');
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(configContent);
  } catch {
    return { valid: false, errors: ['Invalid JSON in config file'] };
  }

  const parseResult = pipelineConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return { valid: false, errors };
  }

  return { valid: true };
}

export async function runPipeline(configPath: string, verbose = false): Promise<PipelineResult> {
  const configContent = await fs.readFile(configPath, 'utf-8');
  const rawConfig = JSON.parse(configContent);

  // Validate with Zod
  const parseResult = pipelineConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    const errors = parseResult.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      success: false,
      stepsCompleted: 0,
      error: `Invalid pipeline config: ${errors.join('; ')}`,
    };
  }

  const config: PipelineConfig = rawConfig;

  if (verbose && !isJsonMode()) {
    console.log(`Running pipeline: ${config.name}`);
    console.log(`Steps: ${config.steps.length}`);
  }

  let data: unknown[] = [];
  let currentStep = 0;

  for (const step of config.steps) {
    currentStep++;

    if (verbose && !isJsonMode()) {
      console.log(`\nStep ${currentStep}: ${step.name} (${step.type})`);
    }

    try {
      switch (step.type) {
        case 'scrape': {
          const scrapeOptions: ScrapyOptions = {
            url: String(step.options.url || ''),
            spider: String(step.options.spider || 'basic'),
            output: String(step.options.output || 'json'),
            depth: Number(step.options.depth) || 1,
            settings: step.options.settings ? String(step.options.settings) : undefined,
            engine: String(step.options.engine || 'scrapy'),
          };
          const result = await runScrapy(scrapeOptions);
          if (!result.success) {
            return { success: false, stepsCompleted: currentStep - 1, error: result.error };
          }
          // Load scraped data
          if (result.outputFile) {
            data = await importFile({ filePath: result.outputFile });
          }
          break;
        }

        case 'generate': {
          const { type, count, locale } = step.options as {
            type?: string;
            count?: number;
            locale?: string;
          };
          data = generateSyntheticData(type || 'person', count || 10, locale || 'en');
          break;
        }

        case 'import': {
          data = await importFile(step.options as { filePath: string });
          break;
        }

        case 'clean': {
          data = cleanData(data, step.options as Parameters<typeof cleanData>[1]);
          break;
        }

        case 'export': {
          const tempOutput = `/tmp/pipeline_export_${Date.now()}.json`;
          await exportDataset({
            inputPath: (step.options.input as string) || tempOutput,
            outputPath: step.options.output as string,
            format: (step.options.format as string) || 'json',
            pretty: step.options.pretty as boolean,
            flatten: step.options.flatten as boolean,
          });
          break;
        }

        case 'format': {
          const formatOptions: ExtendedFormatOptions = {
            inputPath: step.options.input as string,
            outputDir: step.options.outputDir as string,
            formatter: step.options.formatter as string,
            fieldMap: (step.options.fieldMap as Record<string, string>) || {},
            splitRatios: step.options.splitRatios as [number, number, number] | undefined,
            seed: step.options.seed as number,
            systemPrompt: step.options.systemPrompt as string,
            datasetName: step.options.datasetName as string,
            imageField: step.options.imageField as string,
            audioField: step.options.audioField as string,
            copyMedia: step.options.copyMedia as boolean,
            generateCard: step.options.generateCard as boolean,
          };
          await formatDataset(formatOptions);
          break;
        }

        default:
          throw new Error(`Unknown step type: ${(step as PipelineStep).type}`);
      }

      if (verbose && !isJsonMode()) {
        console.log(`  -> ${data.length} records`);
      }
    } catch (error) {
      return {
        success: false,
        stepsCompleted: currentStep - 1,
        error: `Step "${step.name}" failed: ${error}`,
      };
    }
  }

  return { success: true, stepsCompleted: config.steps.length };
}
