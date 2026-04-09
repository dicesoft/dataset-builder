/**
 * Text Q&A Template
 * Generates Q&A pairs from scraped text using LLM
 * Best for: Creating instruction-following training data
 */

import chalk from 'chalk';
import { verboseLog } from '../../utils/logger';
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
  isValidContent,
  deterministicRelevance,
  deterministicQA,
  detectDuplicateContent,
} from '../deterministic';
import { scoreRelevance, generateQA, QAResultMap } from '../llm-processor';
import { LLMAbortError } from '../llm-processor';

export const textQATemplate: TransformTemplate = {
  name: 'text-qa',
  description: 'Generate Q&A training pairs from scraped articles using LLM.',
  supportedInputs: ['text'],
  requiresLlm: true,
  usesVision: false,

  async process(
    records: unknown[],
    options: TransformOptions,
    progressCb?: (progress: TransformProgress) => void
  ): Promise<TransformResult> {
    const startTime = Date.now();

    // Cast to scraped pages
    const pages = records as ScrapedPage[];
    const inputCount = pages.length;

    // Stage 1: Pre-filtering
    progressCb?.({
      total: inputCount,
      completed: 0,
      stage: 'pre-filtering',
      message: `Filtering ${inputCount} pages...`,
    });

    const filterResult = filterScrapedPages(
      pages,
      options.minTextLength,
      options.maxTextLength,
      options.verbose
    );
    const validPages = filterResult.validPages;
    const filteredCount = filterResult.filteredCount;

    // Log filtered details in verbose mode
    if (options.verbose && filterResult.filteredDetails.length > 0) {
      console.log(chalk.gray('\nFiltered records breakdown:'));
      const reasons = filterResult.reasons;
      console.log(chalk.gray(`  - Invalid URL: ${reasons.invalidUrl}`));
      console.log(chalk.gray(`  - Invalid title: ${reasons.invalidTitle}`));
      console.log(chalk.gray(`  - Text too short: ${reasons.textTooShort}`));
      console.log(chalk.gray(`  - Text too long: ${reasons.textTooLong}`));
      console.log(chalk.gray(`  - Low word ratio: ${reasons.lowWordRatio}`));
      console.log(chalk.gray(`  - Missing text: ${reasons.missingText}`));
      console.log(chalk.gray('\nFirst 10 filtered records:'));
      for (const detail of filterResult.filteredDetails.slice(0, 10)) {
        console.log(chalk.gray(`  [${detail.id}] ${detail.reason}`));
        console.log(chalk.gray(`    Title: ${detail.title.substring(0, 60)}...`));
        console.log(chalk.gray(`    URL: ${detail.url.substring(0, 60)}...`));
      }
      if (filterResult.filteredDetails.length > 10) {
        console.log(chalk.gray(`  ... and ${filterResult.filteredDetails.length - 10} more`));
      }
    }

    // Clean text
    const cleanedPages = validPages.map((page) => ({
      ...page,
      text: removeBoilerplate(page.text),
    }));

    // Check for duplicate content
    const { duplicateRate, duplicateCount } = detectDuplicateContent(cleanedPages);
    if (duplicateRate > 0.5) {
      console.warn(
        chalk.yellow(
          `⚠ ${duplicateCount}/${cleanedPages.length} records contain near-identical text. Input may contain boilerplate instead of real content.`
        )
      );
    }

    progressCb?.({
      total: inputCount,
      completed: filteredCount,
      stage: 'pre-filtering',
      message: `Filtered ${filteredCount} invalid pages, ${cleanedPages.length} remaining`,
    });

    // Stage 2: Classification / Relevance scoring
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

        const relevanceScores = await scoreRelevance(
          scoringRecords,
          options.target,
          options,
          progressCb
        );

        relevantPages = cleanedPages.filter((page) => {
          const score = relevanceScores.get(page.id);
          classifiedCount++;
          return (score?.score ?? 0) >= options.relevanceThreshold;
        });
      } catch (error) {
        // Fallback to deterministic
        console.warn('LLM relevance scoring failed, using fallback:', error);
        relevantPages = cleanedPages.filter((page) => {
          const score = deterministicRelevance(page.text, options.target!);
          return score >= options.relevanceThreshold;
        });
      }
    }

    progressCb?.({
      total: cleanedPages.length,
      completed: classifiedCount,
      stage: 'classification',
      message: `${relevantPages.length}/${cleanedPages.length} pages passed relevance threshold`,
    });

    // Stage 3: Q&A Generation
    const outputRecords: TransformRecord[] = [];
    let generationFailedCount = 0;
    let skippedCount = 0;
    let abortedEarly = false;
    let qaResults: QAResultMap | undefined;
    const dropReasons: DropReasons = {};

    if (options.noLlm) {
      // Deterministic fallback
      progressCb?.({
        total: relevantPages.length,
        completed: 0,
        stage: 'generation',
        message: 'Generating Q&A (deterministic mode)...',
      });

      for (let i = 0; i < relevantPages.length; i++) {
        const page = relevantPages[i];
        const qa = deterministicQA(page.title, page.text);

        const meta: TransformMeta = {
          sourceUrl: page.source_url,
          sourceTitle: page.title,
          template: 'text-qa',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        if (options.target) {
          meta.relevanceScore = deterministicRelevance(page.text, options.target);
          meta.isRelevant = meta.relevanceScore >= options.relevanceThreshold;
        }

        outputRecords.push({
          instruction: qa.instruction,
          output: qa.output,
          source_url: page.source_url,
          title: page.title,
          _meta: meta,
        } as TransformRecord);

        progressCb?.({
          total: relevantPages.length,
          completed: i + 1,
          stage: 'generation',
          message: `Generated ${i + 1}/${relevantPages.length} Q&A pairs`,
          estimatedTimeRemaining: Math.round(
            (((Date.now() - startTime) / (i + 1)) * (relevantPages.length - i - 1)) / 1000
          ),
        });
      }
    } else {
      // LLM generation
      progressCb?.({
        total: relevantPages.length,
        completed: 0,
        stage: 'generation',
        message: 'Generating Q&A with LLM...',
      });

      const qaRecords = relevantPages.map((p) => ({
        id: p.id,
        text: p.text,
        title: p.title,
      }));

      try {
        qaResults = await generateQA(qaRecords, options, (progress) => {
          progressCb?.({
            total: relevantPages.length,
            completed: progress.completed,
            stage: 'generation',
            message: progress.message,
            estimatedTimeRemaining: progress.estimatedTimeRemaining,
          });
        });
      } catch (error) {
        if (error instanceof LLMAbortError) {
          qaResults = error.results as QAResultMap;
          abortedEarly = true;
        } else {
          console.error('Q&A generation failed:', error);
          qaResults = new Map() as QAResultMap;
        }
      }

      for (const page of relevantPages) {
        const qa = qaResults!.get(page.id);

        if (qa) {
          verboseLog(`[text-qa] Record ${page.id}: LLM success`);
          const meta: TransformMeta = {
            sourceUrl: page.source_url,
            sourceTitle: page.title,
            template: 'text-qa',
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
          };

          if (options.target) {
            const relevance = deterministicRelevance(page.text, options.target);
            meta.relevanceScore = relevance;
            meta.isRelevant = relevance >= options.relevanceThreshold;
          }

          outputRecords.push({
            instruction: qa.instruction,
            output: qa.output,
            source_url: page.source_url,
            title: page.title,
            _meta: meta,
          } as TransformRecord);
        } else if (options.noFallback) {
          // No-fallback mode: skip this record
          verboseLog(`[text-qa] Record ${page.id}: LLM failed, skipped (noFallback)`);
          skippedCount++;
          generationFailedCount++;
          dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
        } else {
          // Fallback to deterministic QA
          verboseLog(`[text-qa] Record ${page.id}: LLM failed, using deterministic fallback`);
          generationFailedCount++;
          dropReasons.generation_failed = (dropReasons.generation_failed || 0) + 1;
          const fallbackQA = deterministicQA(page.title, page.text);

          const meta: TransformMeta = {
            sourceUrl: page.source_url,
            sourceTitle: page.title,
            template: 'text-qa',
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };

          if (options.target) {
            const relevance = deterministicRelevance(page.text, options.target);
            meta.relevanceScore = relevance;
            meta.isRelevant = relevance >= options.relevanceThreshold;
          }

          outputRecords.push({
            instruction: fallbackQA.instruction,
            output: fallbackQA.output,
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

    if (options.verbose) {
      verboseLog(
        `[text-qa] ${outputRecords.length} records after generation (${generationFailedCount} fallback)`
      );
    }

    // Stage 4: Quality filtering
    let qualityFilteredCount = 0;
    const validRecords = outputRecords.filter((r) => {
      const hasInstruction = typeof r.instruction === 'string' && r.instruction.trim().length > 10;
      const hasOutput = typeof r.output === 'string' && r.output.trim().length > 20;
      const isValid = hasInstruction && hasOutput;
      if (!isValid) {
        qualityFilteredCount++;
      }
      return isValid;
    });
    if (qualityFilteredCount > 0) {
      dropReasons.quality_filtered = qualityFilteredCount;
    }

    if (options.verbose) {
      verboseLog(
        `[text-qa] ${validRecords.length} records after quality filter (${qualityFilteredCount} dropped)`
      );
    }

    // Stage 5: Deduplication
    let finalRecords = validRecords;
    if (options.dedupe) {
      finalRecords = deduplicateRecords(validRecords, ['instruction']);
    }

    if (options.verbose) {
      verboseLog(`[text-qa] ${finalRecords.length} records after dedup`);
    }

    const duration = Date.now() - startTime;

    // Collect failure breakdown from LLM results if available
    const failureBreakdown =
      !options.noLlm && qaResults?.failureBreakdown ? qaResults.failureBreakdown : undefined;

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
        generationFailedCount,
        generationFailureBreakdown: failureBreakdown,
        qualityFilteredCount,
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
