/**
 * Image Classification Template
 * Classifies images using vision models with relevance scoring
 * Best for: Filtering relevant images and creating classification datasets
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
import {
  isJunkAsset,
  filterAssets,
  deduplicateRecords,
  inferLabelFromContext,
} from '../deterministic';
import {
  classifyImages,
  discoverLabels,
  consolidateLabels,
  VisionAbortError,
  SUPPORTED_VISION_FORMATS,
} from '../vision-processor';
import path from 'path';

export const imageClassificationTemplate: TransformTemplate = {
  name: 'image-classification',
  description: 'Classify images with vision model + score relevance to target topic.',
  supportedInputs: ['image'],
  requiresLlm: false, // Uses vision model, not text LLM
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

    // Stage 1: Pre-filtering (remove junk)
    progressCb?.({
      total: inputCount,
      completed: 0,
      stage: 'pre-filtering',
      message: 'Filtering junk assets...',
    });

    const validAssets = filterAssets(assets, true, options._decisionLog);
    const filteredCount = inputCount - validAssets.length;

    progressCb?.({
      total: inputCount,
      completed: filteredCount,
      stage: 'pre-filtering',
      message: `Filtered ${filteredCount} junk assets, ${validAssets.length} remaining`,
    });

    // Stage 2: Vision classification
    const outputRecords: TransformRecord[] = [];
    let classifiedCount = 0;
    let relevantCount = 0;
    let visionFallbackCount = 0;
    let skippedCount = 0;
    let unsupportedFormatCount = 0;
    const formatBreakdown: Record<string, number> = {};
    let abortedEarly = false;
    const dropReasons: DropReasons = {};
    const fallbackReasons: FallbackReasons = {};
    let discoveredLabels: string[] | undefined;

    if (options.noLlm) {
      // Deterministic fallback - use context
      progressCb?.({
        total: validAssets.length,
        completed: 0,
        stage: 'classification',
        message: 'Classifying with context (deterministic mode)...',
      });

      for (let i = 0; i < validAssets.length; i++) {
        const asset = validAssets[i];
        const label = inferLabelFromContext(asset, options.target);
        const relevance = options.target
          ? label.toLowerCase().includes(options.target.toLowerCase())
            ? 0.8
            : 0.3
          : 0.5;

        if (relevance >= options.relevanceThreshold) {
          relevantCount++;
        }

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'image-classification',
          relevanceScore: relevance,
          isRelevant: relevance >= options.relevanceThreshold,
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
          labelSource: 'deterministic',
        };

        outputRecords.push({
          image: asset.localPath,
          label: label,
          caption: asset.context.altText || `Image from ${asset.sourcePageTitle || 'unknown'}`,
          relevance: relevance,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          sourceUrl: asset.sourceUrl,
          sourcePageUrl: asset.sourcePageUrl,
          _meta: meta,
        } as TransformRecord);

        classifiedCount++;

        progressCb?.({
          total: validAssets.length,
          completed: i + 1,
          stage: 'classification',
          message: `Classified ${i + 1}/${validAssets.length} images`,
        });
      }
    } else {
      // Auto-label discovery: sample images, discover categories, then constrain classification
      if (options.autoLabels) {
        progressCb?.({
          total: validAssets.length,
          completed: 0,
          stage: 'discovery',
          message: 'Discovering categories...',
        });

        const rawLabels = await discoverLabels(validAssets, options, progressCb);

        if (rawLabels.length > 0) {
          progressCb?.({
            total: validAssets.length,
            completed: 0,
            stage: 'consolidation',
            message: 'Consolidating discovered labels...',
          });

          discoveredLabels = await consolidateLabels(rawLabels, options);

          // Inject discovered labels into options for classification
          if (discoveredLabels.length > 0) {
            options = { ...options, labels: discoveredLabels };
          }
        }
        // If discovery returned 0 categories, fall back to Mode 1 (free-form)
      }

      // Vision model classification
      progressCb?.({
        total: validAssets.length,
        completed: 0,
        stage: 'vision',
        message: 'Classifying with vision model...',
      });

      let classifications: Map<string, import('../types').ImageClassification>;

      try {
        classifications = await classifyImages(
          validAssets,
          options,
          progressCb,
          options._decisionLog
        );
      } catch (error) {
        if (error instanceof VisionAbortError) {
          classifications = error.results as Map<string, import('../types').ImageClassification>;
          abortedEarly = true;
        } else {
          console.error('Vision classification failed:', error);
          classifications = new Map();
        }
      }

      for (const asset of validAssets) {
        const classification = classifications.get(asset.id);

        if (classification) {
          // VLLM returned result
          classifiedCount++;
          const relevance = classification.relevance ?? 0.5;
          if (relevance >= options.relevanceThreshold) {
            relevantCount++;
          }

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'image-classification',
            relevanceScore: relevance,
            isRelevant: relevance >= options.relevanceThreshold,
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
            labelSource:
              discoveredLabels && discoveredLabels.length > 0
                ? 'auto_discovered'
                : options.labels && options.labels.length > 0
                  ? 'user_labels'
                  : 'vllm',
          };

          outputRecords.push({
            image: asset.localPath,
            label: classification.label,
            caption: classification.caption || asset.context.altText || '',
            relevance: relevance,
            classification_reason: classification.reason || '',
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            sourceUrl: asset.sourceUrl,
            sourcePageUrl: asset.sourcePageUrl,
            _meta: meta,
          } as TransformRecord);
        } else if (options.noFallback) {
          // No-fallback mode: skip this record
          skippedCount++;
          dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
        } else {
          // Fallback to deterministic — determine why VLLM was skipped
          visionFallbackCount++;
          classifiedCount++;

          const ext = path.extname(asset.localPath || asset.fileName).toLowerCase();
          if (!SUPPORTED_VISION_FORMATS.has(ext)) {
            unsupportedFormatCount++;
            formatBreakdown[ext] = (formatBreakdown[ext] || 0) + 1;
            fallbackReasons.unsupported_format = (fallbackReasons.unsupported_format || 0) + 1;
          } else {
            fallbackReasons.vllm_failed = (fallbackReasons.vllm_failed || 0) + 1;
          }

          const label = inferLabelFromContext(asset, options.target);
          const relevance = 0.5;
          if (relevance >= options.relevanceThreshold) {
            relevantCount++;
          }

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'image-classification',
            relevanceScore: relevance,
            isRelevant: relevance >= options.relevanceThreshold,
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
            labelSource: 'deterministic',
          };

          outputRecords.push({
            image: asset.localPath,
            label: label,
            caption: asset.context.altText || '',
            relevance: relevance,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            sourceUrl: asset.sourceUrl,
            sourcePageUrl: asset.sourcePageUrl,
            _meta: meta,
          } as TransformRecord);
        }
      }
    }

    // Check global abort flag (covers cases where abort happened during processing)
    if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
      abortedEarly = true;
    }

    // Stage 3: Filter by relevance threshold if target specified
    let finalRecords = outputRecords;
    let belowThresholdCount = 0;
    if (options.target) {
      finalRecords = outputRecords.filter((r) => {
        const relevance = (r.relevance as number) ?? 0;
        const passes = relevance >= options.relevanceThreshold;
        const recordId = (r._meta?.assetId as string) || '';
        if (!passes) {
          belowThresholdCount++;
          options._decisionLog?.log({
            recordId,
            stage: 'threshold',
            action: 'drop',
            reason: `below_threshold: ${relevance} < ${options.relevanceThreshold}`,
            details: { relevance, threshold: options.relevanceThreshold },
          });
        } else {
          options._decisionLog?.log({
            recordId,
            stage: 'threshold',
            action: 'keep',
            reason: `above_threshold: ${relevance} >= ${options.relevanceThreshold}`,
            details: { relevance, threshold: options.relevanceThreshold },
          });
        }
        return passes;
      });
      if (belowThresholdCount > 0) {
        dropReasons.below_threshold = belowThresholdCount;
      }
    }

    // Stage 4: Deduplication
    if (options.dedupe) {
      finalRecords = deduplicateRecords(finalRecords, ['image']);
    }

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
        classifiedCount,
        relevantCount,
        generatedCount: outputRecords.length,
        visionFallbackCount: visionFallbackCount > 0 ? visionFallbackCount : undefined,
        unsupportedFormatCount: unsupportedFormatCount > 0 ? unsupportedFormatCount : undefined,
        formatBreakdown: unsupportedFormatCount > 0 ? formatBreakdown : undefined,
        skippedCount: skippedCount > 0 ? skippedCount : undefined,
        abortedEarly: abortedEarly || undefined,
        dropReasons: hasDropReasons ? dropReasons : undefined,
        fallbackReasons: hasFallbackReasons ? fallbackReasons : undefined,
        relevanceThreshold: options.target ? options.relevanceThreshold : undefined,
        outputCount: finalRecords.length,
        errorCount: skippedCount,
        duration,
      },
      discoveredLabels:
        discoveredLabels && discoveredLabels.length > 0 ? discoveredLabels : undefined,
    };
  },
};
