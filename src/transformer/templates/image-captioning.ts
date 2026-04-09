/**
 * Image Captioning Template
 * Generates captions for images using vision models
 * Best for: Creating image-text datasets
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
import { captionImages, VisionAbortError, SUPPORTED_VISION_FORMATS } from '../vision-processor';
import path from 'path';

export const imageCaptioningTemplate: TransformTemplate = {
  name: 'image-captioning',
  description: 'Generate captions for images using vision models.',
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

    progressCb?.({
      total: inputCount,
      completed: filteredCount,
      stage: 'pre-filtering',
      message: `Filtered ${filteredCount} invalid assets`,
    });

    // Caption generation
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
      // Fallback: use alt text and context
      for (let i = 0; i < validAssets.length; i++) {
        const asset = validAssets[i];
        const caption = asset.context.altText || '';

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'image-captioning',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        outputRecords.push({
          image: asset.localPath,
          caption: caption,
          text: caption,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          sourceUrl: asset.sourceUrl,
          sourcePageUrl: asset.sourcePageUrl,
          _meta: meta,
        } as TransformRecord);

        generatedCount++;

        progressCb?.({
          total: validAssets.length,
          completed: i + 1,
          stage: 'generation',
          message: `Captioned ${i + 1}/${validAssets.length} images`,
        });
      }
    } else {
      // Vision model captioning
      let captions: Map<string, string>;

      try {
        captions = await captionImages(validAssets, options, progressCb, options._decisionLog);
      } catch (error) {
        if (error instanceof VisionAbortError) {
          captions = error.results as Map<string, string>;
          abortedEarly = true;
        } else {
          console.error('Vision captioning failed:', error);
          captions = new Map();
        }
      }

      for (const asset of validAssets) {
        const caption = captions.get(asset.id);

        if (caption) {
          // VLLM returned result
          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'image-captioning',
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
          };

          outputRecords.push({
            image: asset.localPath,
            caption: caption,
            text: caption,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            sourceUrl: asset.sourceUrl,
            sourcePageUrl: asset.sourcePageUrl,
            _meta: meta,
          } as TransformRecord);

          generatedCount++;
        } else if (options.noFallback) {
          // No-fallback mode: skip this record
          skippedCount++;
          dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
        } else {
          // Fallback to alt text — determine why VLLM was skipped
          visionFallbackCount++;

          const ext = path.extname(asset.localPath || asset.fileName).toLowerCase();
          if (!SUPPORTED_VISION_FORMATS.has(ext)) {
            unsupportedFormatCount++;
            formatBreakdown[ext] = (formatBreakdown[ext] || 0) + 1;
            fallbackReasons.unsupported_format = (fallbackReasons.unsupported_format || 0) + 1;
          } else {
            fallbackReasons.vllm_failed = (fallbackReasons.vllm_failed || 0) + 1;
          }

          const fallbackCaption = asset.context.altText || '';

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'image-captioning',
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };

          outputRecords.push({
            image: asset.localPath,
            caption: fallbackCaption,
            text: fallbackCaption,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            sourceUrl: asset.sourceUrl,
            sourcePageUrl: asset.sourcePageUrl,
            _meta: meta,
          } as TransformRecord);

          generatedCount++;
        }
      }
    }

    // Check global abort flag (covers cases where abort happened during processing)
    if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
      abortedEarly = true;
    }

    // Filter empty captions
    let emptyOutputCount = 0;
    const validRecords = outputRecords.filter((r) => {
      const passes = (r.caption as string)?.length > 5;
      const recordId = (r._meta?.assetId as string) || '';
      if (!passes) {
        emptyOutputCount++;
        options._decisionLog?.log({
          recordId,
          stage: 'quality',
          action: 'drop',
          reason: 'empty_caption',
          details: { captionLength: (r.caption as string)?.length ?? 0 },
        });
      }
      return passes;
    });
    if (emptyOutputCount > 0) {
      dropReasons.empty_output = emptyOutputCount;
    }

    // Deduplicate
    let finalRecords = options.dedupe
      ? deduplicateRecords(validRecords, ['image', 'caption'])
      : validRecords;

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
        relevantCount: validRecords.length,
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
