/**
 * Text Instruction Template
 * Generates instruction + summary from scraped text using LLM
 * Best for: Alpaca-style instruction-following datasets
 */

import {
  TransformTemplate,
  TransformOptions,
  TransformResult,
  TransformProgress,
  TransformRecord,
  TransformMeta,
  ScrapedPage,
  DropReasons,
} from '../types';
import {
  removeBoilerplate,
  filterScrapedPages,
  deduplicateRecords,
  deterministicRelevance,
} from '../deterministic';
import { scoreRelevance, generateInstruction, LLMAbortError } from '../llm-processor';

export const textInstructTemplate: TransformTemplate = {
  name: 'text-instruct',
  description: 'Generate instruction + summary pairs from articles. Best for Alpaca format.',
  supportedInputs: ['text'],
  requiresLlm: true,
  usesVision: false,

  async process(
    records: unknown[],
    options: TransformOptions,
    progressCb?: (progress: TransformProgress) => void
  ): Promise<TransformResult> {
    const startTime = Date.now();
    const pages = records as ScrapedPage[];
    const inputCount = pages.length;

    // Pre-filtering
    progressCb?.({
      total: inputCount,
      completed: 0,
      stage: 'pre-filtering',
      message: 'Filtering pages...',
    });

    const filterResult = filterScrapedPages(
      pages,
      options.minTextLength,
      options.maxTextLength,
      options.verbose
    );
    const validPages = filterResult.validPages;
    const filteredCount = filterResult.filteredCount;

    const cleanedPages = validPages.map((page) => ({
      ...page,
      text: removeBoilerplate(page.text),
    }));

    // Relevance scoring
    let relevantPages = cleanedPages;
    let classifiedCount = 0;

    if (options.target && !options.noLlm) {
      progressCb?.({
        total: cleanedPages.length,
        completed: 0,
        stage: 'classification',
        message: `Scoring relevance to "${options.target}"...`,
      });

      try {
        const scoringRecords = cleanedPages.map((p) => ({
          id: p.id,
          text: p.text,
          title: p.title,
        }));

        const scores = await scoreRelevance(scoringRecords, options.target, options, progressCb);
        relevantPages = cleanedPages.filter((page) => {
          const score = scores.get(page.id);
          classifiedCount++;
          return (score?.score ?? 0) >= options.relevanceThreshold;
        });
      } catch {
        relevantPages = cleanedPages.filter((page) => {
          const score = deterministicRelevance(page.text, options.target!);
          return score >= options.relevanceThreshold;
        });
      }
    }

    // Generation
    const outputRecords: TransformRecord[] = [];
    let generationFailedCount = 0;
    let skippedCount = 0;
    let abortedEarly = false;
    const dropReasons: DropReasons = {};

    if (options.noLlm) {
      // Deterministic fallback - simple instruction format
      for (const page of relevantPages) {
        const meta: TransformMeta = {
          sourceUrl: page.source_url,
          sourceTitle: page.title,
          template: 'text-instruct',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        if (options.target) {
          meta.relevanceScore = deterministicRelevance(page.text, options.target);
          meta.isRelevant = meta.relevanceScore >= options.relevanceThreshold;
        }

        outputRecords.push({
          instruction: `Summarize ${page.title}`,
          input: '',
          output: page.text.slice(0, 1000),
          source_url: page.source_url,
          title: page.title,
          _meta: meta,
        } as TransformRecord);
      }
    } else {
      let results: Map<string, { instruction: string; input: string; output: string }>;

      try {
        const instructRecords = relevantPages.map((p) => ({
          id: p.id,
          text: p.text,
          title: p.title,
        }));

        results = await generateInstruction(instructRecords, options, progressCb);
      } catch (error) {
        if (error instanceof LLMAbortError) {
          results = error.results as Map<
            string,
            { instruction: string; input: string; output: string }
          >;
          abortedEarly = true;
        } else {
          console.error('Instruction generation failed:', error);
          results = new Map();
        }
      }

      for (const page of relevantPages) {
        const inst = results.get(page.id);

        if (inst) {
          const meta: TransformMeta = {
            sourceUrl: page.source_url,
            sourceTitle: page.title,
            template: 'text-instruct',
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
          };

          if (options.target) {
            const relevance = deterministicRelevance(page.text, options.target);
            meta.relevanceScore = relevance;
            meta.isRelevant = relevance >= options.relevanceThreshold;
          }

          outputRecords.push({
            instruction: inst.instruction,
            input: inst.input,
            output: inst.output,
            source_url: page.source_url,
            title: page.title,
            _meta: meta,
          } as TransformRecord);
        } else if (options.noFallback) {
          // No-fallback mode: skip this record
          skippedCount++;
          generationFailedCount++;
          dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
        } else {
          // Fallback to deterministic
          generationFailedCount++;
          dropReasons.generation_failed = (dropReasons.generation_failed || 0) + 1;

          const meta: TransformMeta = {
            sourceUrl: page.source_url,
            sourceTitle: page.title,
            template: 'text-instruct',
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };

          outputRecords.push({
            instruction: `Summarize ${page.title}`,
            input: '',
            output: page.text.slice(0, 1000),
            source_url: page.source_url,
            title: page.title,
            _meta: meta,
          } as TransformRecord);
        }
      }
    }

    // Check global abort flag (covers cases where abort happened during processing)
    if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
      abortedEarly = true;
    }

    // Quality filtering and dedupe
    const validRecords = outputRecords.filter((r) => {
      const hasInstruction = typeof r.instruction === 'string' && r.instruction.length > 5;
      const hasOutput = typeof r.output === 'string' && r.output.length > 50;
      return hasInstruction && hasOutput;
    });

    let finalRecords = options.dedupe
      ? deduplicateRecords(validRecords, ['instruction'])
      : validRecords;

    const duration = Date.now() - startTime;
    const hasDropReasons = Object.keys(dropReasons).length > 0;

    return {
      records: finalRecords,
      stats: {
        inputCount,
        filteredCount,
        filterReasons: filterResult.reasons,
        classifiedCount,
        relevantCount: relevantPages.length,
        generatedCount: outputRecords.length,
        generationFailedCount: generationFailedCount > 0 ? generationFailedCount : undefined,
        skippedCount: skippedCount > 0 ? skippedCount : undefined,
        abortedEarly: abortedEarly || undefined,
        dropReasons: hasDropReasons ? dropReasons : undefined,
        outputCount: finalRecords.length,
        errorCount: skippedCount,
        duration,
      },
    };
  },
};
