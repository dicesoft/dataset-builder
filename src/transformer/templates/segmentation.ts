/**
 * Segmentation Template
 * Uses SAM2 (Segment Anything Model 2) via Python subprocess
 * Optionally labels segments via Ollama vision model
 * Best for: Generating instance segmentation datasets with pixel masks
 */

import path from 'path';
import fs from 'fs/promises';
import {
  TransformTemplate,
  TransformOptions,
  TransformResult,
  TransformProgress,
  TransformRecord,
  TransformMeta,
  AssetRecord,
  SegmentationResult,
  DropReasons,
} from '../types';
import { filterAssets, deduplicateRecords } from '../deterministic';
import { runPythonScript, findPython, checkPythonPackage } from '../python-runner';
import { classifyImages } from '../vision-processor';

/**
 * Run SAM segmentation on a single image via Python subprocess
 */
async function runSamSegmentation(
  imagePath: string,
  outputDir: string,
  model: string,
  pointsPerSide: number
): Promise<SegmentationResult> {
  const scriptPath = path.resolve(__dirname, '../../../scripts/sam_segment.py');
  const result = await runPythonScript(scriptPath, [
    '--image',
    imagePath,
    '--output-dir',
    outputDir,
    '--model',
    model,
    '--points-per-side',
    String(pointsPerSide),
  ]);

  if (!result.success || !result.jsonOutput) {
    const errorMsg =
      (result.jsonOutput as Record<string, unknown>)?.error ||
      result.error ||
      'SAM segmentation failed';
    throw new Error(String(errorMsg));
  }

  const json = result.jsonOutput as Record<string, unknown>;
  if (json.error) {
    throw new Error(String(json.error));
  }

  return {
    masks: (json.masks as Array<Record<string, unknown>>).map((m) => ({
      label: String(m.label || 'segment'),
      mask_path: String(m.mask_path || ''),
      area: Number(m.area || 0),
      bbox: m.bbox as [number, number, number, number],
    })),
    image_width: Number(json.image_width || 0),
    image_height: Number(json.image_height || 0),
  };
}

export const segmentationTemplate: TransformTemplate = {
  name: 'segmentation',
  description: 'Instance segmentation with SAM2 masks + optional Ollama labeling',
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

    // Stage 1: Pre-filtering
    progressCb?.({
      total: inputCount,
      completed: 0,
      stage: 'pre-filtering',
      message: 'Filtering junk assets...',
    });

    const validAssets = filterAssets(assets, true, options._decisionLog);
    const filteredCount = inputCount - validAssets.length;

    // Stage 2: Check Python + ultralytics
    const python = await findPython();
    if (!python) {
      console.error(
        'Python 3 not found. SAM segmentation requires Python 3.8+ with ultralytics installed.'
      );
      return {
        records: [],
        stats: {
          inputCount,
          filteredCount,
          classifiedCount: 0,
          relevantCount: 0,
          generatedCount: 0,
          outputCount: 0,
          errorCount: inputCount,
          duration: Date.now() - startTime,
        },
      };
    }

    const hasUltralytics = await checkPythonPackage('ultralytics');
    if (!hasUltralytics) {
      console.error(
        'ultralytics not installed. Install with: pip install ultralytics Pillow numpy\n' +
          'Or: pip install -r scripts/requirements-cv.txt'
      );
      return {
        records: [],
        stats: {
          inputCount,
          filteredCount,
          classifiedCount: 0,
          relevantCount: 0,
          generatedCount: 0,
          outputCount: 0,
          errorCount: inputCount,
          duration: Date.now() - startTime,
        },
      };
    }

    // Stage 3: Run SAM per image
    const samModel = options.model?.startsWith('sam') ? options.model : 'sam2.1_b.pt';
    const outputRecords: TransformRecord[] = [];
    let classifiedCount = 0;
    let skippedCount = 0;
    let abortedEarly = false;
    const generationStartTime = Date.now();

    // Create masks output directory
    const baseDir = options.assetDir || path.dirname(options.input);
    const masksDir = path.join(baseDir, 'masks');
    await fs.mkdir(masksDir, { recursive: true });

    progressCb?.({
      total: validAssets.length,
      completed: 0,
      stage: 'vision',
      message: `Running SAM segmentation (${samModel})...`,
    });

    // Collect all segments first, optionally label them later
    const allSegments: Array<{
      asset: AssetRecord;
      segResult: SegmentationResult;
    }> = [];

    for (let i = 0; i < validAssets.length; i++) {
      if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
        abortedEarly = true;
        break;
      }

      const asset = validAssets[i];
      const fullPath = path.resolve(baseDir, asset.localPath);

      try {
        const segResult = await runSamSegmentation(fullPath, masksDir, samModel, 32);
        allSegments.push({ asset, segResult });
        classifiedCount++;
      } catch (error) {
        console.warn(`SAM segmentation failed for ${asset.fileName}:`, error);
        skippedCount++;
      }

      progressCb?.({
        total: validAssets.length,
        completed: i + 1,
        stage: 'vision',
        message: `SAM segmentation: ${i + 1}/${validAssets.length}`,
      });
    }

    // Stage 4: Optional Ollama labeling
    const useLabeling = !options.noLlm && allSegments.length > 0;
    let labelMap: Map<string, string> | undefined;

    if (useLabeling) {
      progressCb?.({
        total: allSegments.length,
        completed: 0,
        stage: 'labeling',
        message: 'Labeling segments with vision model...',
      });

      try {
        // Use classifyImages for labeling — it gives us label + relevance
        const assetsForLabeling = allSegments.map((s) => s.asset);
        const classifications = await classifyImages(
          assetsForLabeling,
          options,
          undefined,
          options._decisionLog
        );
        labelMap = new Map();
        for (const [id, cls] of classifications) {
          labelMap.set(id, cls.label);
        }
      } catch {
        // Labeling is optional — continue with segment_N labels
      }
    }

    // Build output records
    for (const { asset, segResult } of allSegments) {
      const imageLabel = labelMap?.get(asset.id);

      for (let j = 0; j < segResult.masks.length; j++) {
        const mask = segResult.masks[j];
        const label = imageLabel || mask.label;

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'segmentation',
          processedAt: new Date().toISOString(),
          generationMethod: useLabeling && labelMap?.has(asset.id) ? 'hybrid' : 'llm',
        };

        outputRecords.push({
          image: asset.localPath,
          mask_path: mask.mask_path,
          category: label,
          bbox: mask.bbox,
          area: mask.area,
          image_width: segResult.image_width,
          image_height: segResult.image_height,
          _meta: meta,
        } as TransformRecord);
      }
    }

    // Check abort flag
    if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
      abortedEarly = true;
    }

    // Stage 5: Deduplication
    let finalRecords = outputRecords;
    if (options.dedupe) {
      finalRecords = deduplicateRecords(finalRecords, ['image', 'mask_path']);
    }

    const duration = Date.now() - startTime;

    return {
      records: finalRecords,
      stats: {
        inputCount,
        completedInputCount: failedInputCount > 0 ? completedInputCount : undefined,
        failedInputCount: failedInputCount > 0 ? failedInputCount : undefined,
        filteredCount,
        classifiedCount,
        relevantCount: outputRecords.length,
        generatedCount: outputRecords.length,
        generationDuration: Date.now() - generationStartTime,
        skippedCount: skippedCount > 0 ? skippedCount : undefined,
        abortedEarly: abortedEarly || undefined,
        outputCount: finalRecords.length,
        errorCount: skippedCount,
        duration,
      },
    };
  },
};
