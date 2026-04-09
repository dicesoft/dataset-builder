/**
 * Audio Classification Template
 * Classifies audio files using context from scraped pages
 * Best for: Creating audio classification datasets
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
} from '../types';
import { filterAssets, deduplicateRecords, inferLabelFromContext } from '../deterministic';
import { getOllama } from '../../generators/ollama';
import { getConfig } from '../../config';

export const audioClassificationTemplate: TransformTemplate = {
  name: 'audio-classification',
  description: 'Classify audio files from context metadata. Uses LLM for smart labeling.',
  supportedInputs: ['audio'],
  requiresLlm: true,
  usesVision: false,

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

    // Pre-filtering
    const validAssets = filterAssets(assets, true, options._decisionLog);
    const filteredCount = inputCount - validAssets.length;

    progressCb?.({
      total: inputCount,
      completed: filteredCount,
      stage: 'pre-filtering',
      message: `Filtered ${filteredCount} invalid assets, ${validAssets.length} remaining`,
    });

    // Classification
    const outputRecords: TransformRecord[] = [];
    let classifiedCount = 0;
    const dropReasons: DropReasons = {};

    if (options.noLlm) {
      // Deterministic: infer from context
      for (let i = 0; i < validAssets.length; i++) {
        const asset = validAssets[i];
        const label = inferLabelFromContext(asset, options.target);

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'audio-classification',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        outputRecords.push({
          audio: asset.localPath,
          label: label,
          description: asset.context.surroundingText || '',
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
          message: `Classified ${i + 1}/${validAssets.length} audio files`,
        });
      }
    } else {
      // LLM-based classification from context
      const ollama = getOllama();
      const config = getConfig();
      const model = options.model || config.get('ollamaModel');

      for (let i = 0; i < validAssets.length; i++) {
        const asset = validAssets[i];

        try {
          const prompt = `Classify this audio file based on its context:

Filename: ${asset.fileName}
Page Title: ${asset.sourcePageTitle}
Tags: ${asset.context.tags.join(', ')}
Surrounding Text: ${asset.context.surroundingText?.slice(0, 500) || 'N/A'}

Target Topic: ${options.target || 'general'}

Respond with JSON:
{
  "label": "specific category (e.g., 'music', 'speech', 'podcast', 'sound effect')",
  "confidence": 0.0-1.0,
  "description": "brief description of likely content"
}`;

          const response = await ollama.generate({
            model,
            prompt,
            format: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                confidence: { type: 'number' },
                description: { type: 'string' },
              },
              required: ['label', 'confidence', 'description'],
            },
            temperature: 0.3,
          });

          const parsed = JSON.parse(response.response);

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'audio-classification',
            relevanceScore: parsed.confidence,
            isRelevant: (parsed.confidence ?? 0) >= options.relevanceThreshold,
            processedAt: new Date().toISOString(),
            generationMethod: 'llm',
          };

          outputRecords.push({
            audio: asset.localPath,
            label: parsed.label,
            confidence: parsed.confidence,
            description: parsed.description,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            sourceUrl: asset.sourceUrl,
            sourcePageUrl: asset.sourcePageUrl,
            _meta: meta,
          } as TransformRecord);
        } catch (error) {
          // Fallback
          dropReasons.generation_failed = (dropReasons.generation_failed || 0) + 1;
          const label = inferLabelFromContext(asset, options.target);

          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'audio-classification',
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };

          outputRecords.push({
            audio: asset.localPath,
            label: label,
            description: '',
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            sourceUrl: asset.sourceUrl,
            sourcePageUrl: asset.sourcePageUrl,
            _meta: meta,
          } as TransformRecord);
        }

        classifiedCount++;

        progressCb?.({
          total: validAssets.length,
          completed: i + 1,
          stage: 'classification',
          message: `Classified ${i + 1}/${validAssets.length} audio files`,
        });
      }
    }

    // Filter by relevance if target specified
    let finalRecords = outputRecords;
    if (options.target) {
      finalRecords = outputRecords.filter((r) => {
        const confidence = (r.confidence as number) ?? 0;
        return confidence >= options.relevanceThreshold;
      });
    }

    // Deduplicate
    if (options.dedupe) {
      finalRecords = deduplicateRecords(finalRecords, ['audio']);
    }

    const duration = Date.now() - startTime;

    const hasDropReasons = Object.keys(dropReasons).length > 0;

    return {
      records: finalRecords,
      stats: {
        inputCount,
        completedInputCount: failedInputCount > 0 ? completedInputCount : undefined,
        failedInputCount: failedInputCount > 0 ? failedInputCount : undefined,
        filteredCount,
        classifiedCount,
        relevantCount: finalRecords.length,
        generatedCount: outputRecords.length,
        dropReasons: hasDropReasons ? dropReasons : undefined,
        outputCount: finalRecords.length,
        errorCount: 0,
        duration,
      },
    };
  },
};
