/**
 * Vision Q&A Template
 * Generates Q&A pairs about images using vision models
 * Best for: Visual question answering datasets
 */

import {
  TransformTemplate,
  TransformOptions,
  TransformResult,
  TransformProgress,
  TransformRecord,
  TransformMeta,
  AssetRecord,
  DropReasons,
  FallbackReasons,
} from '../types';
import { filterAssets, deduplicateRecords } from '../deterministic';
import { generateVisionQA, VisionAbortError, SUPPORTED_VISION_FORMATS } from '../vision-processor';
import path from 'path';
import chalk from 'chalk';

/**
 * Generate contextual Q&A from available metadata
 */
function generateContextualQA(
  asset: AssetRecord,
  target?: string
): { question: string; answer: string }[] {
  const qa: { question: string; answer: string }[] = [];

  // Extract meaningful name from filename
  const cleanFileName = asset.fileName
    ?.replace(/\.[^/.]+$/, '') // Remove extension
    ?.replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
    ?.replace(/\d+$/, '') // Remove trailing numbers
    ?.trim();

  // Extract from page title
  const pageTitle = asset.sourcePageTitle || '';
  const siteName = pageTitle.split(/\||[-–]/)[0]?.trim() || '';

  // Build contextual answer based on available metadata
  let contextualAnswer = '';
  let subject = '';

  if (
    cleanFileName &&
    cleanFileName.length > 2 &&
    !cleanFileName.match(/^image|img|pic|photo|screenshot$/i)
  ) {
    // Use filename as primary descriptor
    subject = cleanFileName;
    contextualAnswer = `This appears to be ${subject}.`;
  } else if (siteName && siteName.length > 2) {
    // Fall back to site name
    subject = siteName;
    contextualAnswer = `This image is from ${subject}.`;
  } else if (pageTitle) {
    subject = pageTitle;
    contextualAnswer = `This image is from ${subject}.`;
  }

  // Generate contextual questions based on target
  if (target) {
    const targetLower = target.toLowerCase();
    qa.push({
      question: `What ${targetLower} is shown in this image?`,
      answer: contextualAnswer || `This appears to be a ${targetLower}.`,
    });
  } else if (subject) {
    qa.push({
      question: `What is shown in this image?`,
      answer: contextualAnswer,
    });
  } else {
    // Ultimate fallback
    qa.push({
      question: `What is shown in this image?`,
      answer:
        asset.context.altText ||
        `An image from ${asset.sourceUrl?.split('/')[2] || 'unknown source'}.`,
    });
  }

  // Add a follow-up question if we have context
  if (subject && target) {
    qa.push({
      question: `Can you describe this ${target.toLowerCase()}?`,
      answer: `This is ${subject}.`,
    });
  } else if (subject) {
    qa.push({
      question: `What can you tell me about this image?`,
      answer: `This shows ${subject}.`,
    });
  }

  return qa;
}

export const visionQATemplate: TransformTemplate = {
  name: 'vision-qa',
  description: 'Generate Q&A pairs about images using vision models.',
  supportedInputs: ['image'],
  requiresLlm: false,
  usesVision: true,

  async process(
    records: unknown[],
    options: TransformOptions,
    progressCb?: (progress: TransformProgress) => void
  ): Promise<TransformResult> {
    const startTime = Date.now();
    const assets = records as AssetRecord[];
    const inputCount = assets.length;

    // Track completed vs failed input records
    const completedInputCount = assets.filter((a) => a.status === 'completed').length;
    const failedInputCount = assets.filter((a) => a.status !== 'completed').length;

    // Pre-filtering - only keep assets with valid local paths
    const allValidAssets = filterAssets(assets, true, options._decisionLog);
    const validAssets = allValidAssets.filter((asset) => !!asset.localPath);
    const filteredCount = inputCount - validAssets.length;

    // Generate Q&A
    const outputRecords: TransformRecord[] = [];
    let generatedCount = 0;
    let visionFallbackCount = 0;
    let skippedCount = 0;
    let unsupportedFormatCount = 0;
    const formatBreakdown: Record<string, number> = {};
    let abortedEarly = false;
    const dropReasons: DropReasons = {};
    const fallbackReasons: FallbackReasons = {};

    if (options.noLlm) {
      // Fallback: contextual questions from metadata
      for (const asset of validAssets) {
        const qa = generateContextualQA(asset, options.target);
        const conversations = qa.flatMap((q, i) => [
          { from: 'human', value: i === 0 ? `<image>\n${q.question}` : q.question },
          { from: 'gpt', value: q.answer },
        ]);

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'vision-qa',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        outputRecords.push({
          image: asset.localPath,
          conversations,
          fileName: asset.fileName,
          sourceUrl: asset.sourceUrl,
          _meta: meta,
        } as TransformRecord);

        generatedCount++;
      }
    } else {
      // Vision Q&A generation
      let vllmCount = 0;
      let fallbackCount = 0;
      let qaResults: Map<string, { question: string; answer: string }[]>;

      try {
        qaResults = await generateVisionQA(validAssets, options, progressCb, options._decisionLog);
      } catch (error) {
        if (error instanceof VisionAbortError) {
          // Use partial results from the abort error
          qaResults = error.results as Map<string, { question: string; answer: string }[]>;
          abortedEarly = true;
        } else {
          console.error('Vision Q&A generation failed:', error);
          qaResults = new Map();
        }
      }

      for (const asset of validAssets) {
        const qa = qaResults.get(asset.id);

        if (qa) {
          // VLLM returned results
          const conversations = qa.flatMap((q, i) => [
            { from: 'human', value: i === 0 ? `<image>\n${q.question}` : q.question },
            { from: 'gpt', value: q.answer },
          ]);

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'vision-qa',
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
          };

          outputRecords.push({
            image: asset.localPath,
            conversations,
            fileName: asset.fileName,
            sourceUrl: asset.sourceUrl,
            _meta: meta,
          } as TransformRecord);

          vllmCount++;
          generatedCount++;
        } else if (options.noFallback) {
          // No-fallback mode: skip this record
          skippedCount++;
          dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
        } else {
          // Fallback to contextual QA — determine why VLLM was skipped
          const ext = path.extname(asset.localPath || asset.fileName).toLowerCase();
          if (!SUPPORTED_VISION_FORMATS.has(ext)) {
            unsupportedFormatCount++;
            formatBreakdown[ext] = (formatBreakdown[ext] || 0) + 1;
            fallbackReasons.unsupported_format = (fallbackReasons.unsupported_format || 0) + 1;
          } else {
            fallbackReasons.vllm_failed = (fallbackReasons.vllm_failed || 0) + 1;
          }

          const contextualQA = generateContextualQA(asset, options.target);
          const conversations = contextualQA
            .map((q, i) => [
              { from: 'human', value: i === 0 ? `<image>\n${q.question}` : q.question },
              { from: 'gpt', value: q.answer },
            ])
            .flat();

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'vision-qa',
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };

          outputRecords.push({
            image: asset.localPath,
            conversations,
            fileName: asset.fileName,
            sourceUrl: asset.sourceUrl,
            _meta: meta,
          } as TransformRecord);

          fallbackCount++;
          generatedCount++;
        }
      }

      // Warn about fallback usage
      if (fallbackCount > 0) {
        const total = vllmCount + fallbackCount;
        console.warn(
          chalk.yellow(
            `\n  Warning: ${fallbackCount}/${total} assets used deterministic fallback (VLLM skipped)`
          )
        );
        if (vllmCount === 0) {
          console.warn(
            chalk.yellow(
              '  None used VLLM. Check that images exist and Ollama is running with a vision model.'
            )
          );
        }
      }

      visionFallbackCount = fallbackCount;
    }

    // Check global abort flag (covers cases where abort happened during processing)
    if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
      abortedEarly = true;
    }

    // Deduplicate
    let finalRecords = options.dedupe
      ? deduplicateRecords(outputRecords, ['image'])
      : outputRecords;

    const duration = Date.now() - startTime;
    const hasDropReasons = Object.keys(dropReasons).length > 0;
    const hasFallbackReasons = Object.keys(fallbackReasons).length > 0;

    return {
      records: finalRecords,
      stats: {
        inputCount,
        completedInputCount: failedInputCount > 0 ? completedInputCount : undefined,
        failedInputCount: failedInputCount > 0 ? failedInputCount : undefined,
        filteredCount,
        classifiedCount: 0,
        relevantCount: outputRecords.length,
        generatedCount,
        visionFallbackCount: visionFallbackCount > 0 ? visionFallbackCount : undefined,
        unsupportedFormatCount: unsupportedFormatCount > 0 ? unsupportedFormatCount : undefined,
        formatBreakdown: unsupportedFormatCount > 0 ? formatBreakdown : undefined,
        skippedCount: skippedCount > 0 ? skippedCount : undefined,
        abortedEarly: abortedEarly || undefined,
        dropReasons: hasDropReasons ? dropReasons : undefined,
        fallbackReasons: hasFallbackReasons ? fallbackReasons : undefined,
        outputCount: finalRecords.length,
        errorCount: skippedCount,
        duration,
      },
    };
  },
};
