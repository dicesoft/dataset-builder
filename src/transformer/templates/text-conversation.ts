/**
 * Text Conversation Template
 * Generates multi-turn conversations from scraped articles
 * Best for: ChatML, ShareGPT format datasets
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
import { scoreRelevance, generateConversation, LLMAbortError } from '../llm-processor';

export const textConversationTemplate: TransformTemplate = {
  name: 'text-conversation',
  description: 'Generate multi-turn conversations from articles. Best for ChatML/ShareGPT.',
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
      // Simple fallback conversation
      for (const page of relevantPages) {
        const meta: TransformMeta = {
          sourceUrl: page.source_url,
          sourceTitle: page.title,
          template: 'text-conversation',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        if (options.target) {
          meta.relevanceScore = deterministicRelevance(page.text, options.target);
        }

        outputRecords.push({
          conversation: [
            { role: 'user', content: `Tell me about ${page.title}` },
            { role: 'assistant', content: page.text.slice(0, 1000) },
          ],
          source_url: page.source_url,
          title: page.title,
          _meta: meta,
        } as TransformRecord);
      }
    } else {
      let results: Map<string, import('../types').ConversationTurn[]>;

      try {
        const convRecords = relevantPages.map((p) => ({
          id: p.id,
          text: p.text,
          title: p.title,
        }));

        results = await generateConversation(convRecords, options, progressCb);
      } catch (error) {
        if (error instanceof LLMAbortError) {
          results = error.results as Map<string, import('../types').ConversationTurn[]>;
          abortedEarly = true;
        } else {
          console.error('Conversation generation failed:', error);
          results = new Map();
        }
      }

      for (const page of relevantPages) {
        const conversation = results.get(page.id);

        if (conversation) {
          const meta: TransformMeta = {
            sourceUrl: page.source_url,
            sourceTitle: page.title,
            template: 'text-conversation',
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
          };

          if (options.target) {
            const relevance = deterministicRelevance(page.text, options.target);
            meta.relevanceScore = relevance;
            meta.isRelevant = relevance >= options.relevanceThreshold;
          }

          outputRecords.push({
            conversation: conversation.map((turn) => ({
              role: turn.role,
              content: turn.content,
            })),
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
            template: 'text-conversation',
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };

          outputRecords.push({
            conversation: [
              { role: 'user', content: `Tell me about ${page.title}` },
              { role: 'assistant', content: page.text.slice(0, 1000) },
            ],
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

    // Quality filtering
    let qualityFilteredCount = 0;
    const validRecords = outputRecords.filter((r) => {
      const conv = r.conversation as { role: string; content: string }[] | undefined;
      const passes = conv && conv.length >= 2 && conv.every((t) => t.content?.length > 10);
      if (!passes) qualityFilteredCount++;
      return passes;
    });
    if (qualityFilteredCount > 0) {
      dropReasons.quality_filtered = qualityFilteredCount;
    }

    let finalRecords = options.dedupe
      ? deduplicateRecords(validRecords, ['conversation'])
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
