/**
 * Object Detection Template
 * Dual-engine: YOLOv8 (Python/ultralytics) or VLLM (Ollama vision models)
 * Best for: Generating object detection datasets with bboxes
 */

import path from 'path';
import {
  TransformTemplate,
  TransformOptions,
  TransformResult,
  TransformProgress,
  TransformRecord,
  TransformMeta,
  AssetRecord,
  ObjectDetection,
  DropReasons,
  FallbackReasons,
} from '../types';
import { filterAssets, deduplicateRecords, inferLabelFromContext } from '../deterministic';
import { detectObjects, VisionAbortError, SUPPORTED_VISION_FORMATS } from '../vision-processor';
import { runPythonScript, checkPythonPackage } from '../python-runner';
import { getImageDimensions } from '../image-utils';

/**
 * Check if model name indicates YOLO engine
 */
function isYoloModel(model?: string): boolean {
  if (!model) return true; // Default to YOLO
  return model.toLowerCase().startsWith('yolo');
}

/**
 * Run YOLOv8 detection on a single image via Python subprocess
 */
async function runYoloDetection(
  imagePath: string,
  model: string,
  conf: number
): Promise<ObjectDetection> {
  const scriptPath = path.resolve(__dirname, '../../../scripts/yolo_detect.py');
  const result = await runPythonScript(scriptPath, [
    '--image',
    imagePath,
    '--model',
    model,
    '--conf',
    String(conf),
  ]);

  if (!result.success || !result.jsonOutput) {
    const errorMsg =
      (result.jsonOutput as Record<string, unknown>)?.error ||
      result.error ||
      'YOLO detection failed';
    throw new Error(String(errorMsg));
  }

  const json = result.jsonOutput as Record<string, unknown>;
  if (json.error) {
    throw new Error(String(json.error));
  }

  return {
    objects: (json.objects as Array<Record<string, unknown>>).map((obj) => ({
      label: String(obj.label || 'unknown'),
      bbox: obj.bbox as [number, number, number, number],
      confidence: Number(obj.confidence || 0),
    })),
    image_width: Number(json.image_width || 0),
    image_height: Number(json.image_height || 0),
  };
}

export const objectDetectionTemplate: TransformTemplate = {
  name: 'object-detection',
  description: 'Detect objects with bounding boxes (YOLOv8 or VLLM engine)',
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
    const useYolo = isYoloModel(options.model) && !options.noLlm;

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

    // Stage 2: Detection
    const outputRecords: TransformRecord[] = [];
    let classifiedCount = 0;
    let relevantCount = 0;
    let visionFallbackCount = 0;
    let skippedCount = 0;
    let unsupportedFormatCount = 0;
    const formatBreakdown: Record<string, number> = {};
    let abortedEarly = false;
    let generationStartTime: number | undefined;
    const dropReasons: DropReasons = {};
    const fallbackReasons: FallbackReasons = {};

    if (options.noLlm) {
      // Deterministic fallback: single full-image bbox per image
      progressCb?.({
        total: validAssets.length,
        completed: 0,
        stage: 'detection',
        message: 'Generating deterministic detections...',
      });

      for (let i = 0; i < validAssets.length; i++) {
        const asset = validAssets[i];
        const baseDir = options.assetDir || path.dirname(options.input);
        const fullPath = path.resolve(baseDir, asset.localPath);

        let dims = { width: 640, height: 480 };
        try {
          dims = await getImageDimensions(fullPath);
        } catch {
          // Use defaults
        }

        const label = inferLabelFromContext(asset, options.target);

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'object-detection',
          relevanceScore: 0.5,
          isRelevant: true,
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        outputRecords.push({
          image: asset.localPath,
          bbox: [0, 0, dims.width, dims.height],
          category: label,
          confidence: 0.5,
          image_width: dims.width,
          image_height: dims.height,
          _meta: meta,
        } as TransformRecord);

        classifiedCount++;
        relevantCount++;

        progressCb?.({
          total: validAssets.length,
          completed: i + 1,
          stage: 'detection',
          message: `Deterministic detection: ${i + 1}/${validAssets.length}`,
        });
      }
    } else if (useYolo) {
      // YOLO engine via Python subprocess
      const hasUltralytics = await checkPythonPackage('ultralytics');
      if (!hasUltralytics) {
        console.warn(
          'ultralytics not installed. Install with: pip install ultralytics\nFalling back to VLLM detection.'
        );
        // Fall through to VLLM path below
        return this.process(records, { ...options, model: 'llava' }, progressCb);
      }

      const modelName = options.model || 'yolov8n';
      const confThreshold = options.relevanceThreshold;
      generationStartTime = Date.now();

      progressCb?.({
        total: validAssets.length,
        completed: 0,
        stage: 'vision',
        message: `Running YOLOv8 detection (${modelName})...`,
      });

      for (let i = 0; i < validAssets.length; i++) {
        if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
          abortedEarly = true;
          break;
        }

        const asset = validAssets[i];
        const baseDir = options.assetDir || path.dirname(options.input);
        const fullPath = path.resolve(baseDir, asset.localPath);

        try {
          const detection = await runYoloDetection(fullPath, modelName, confThreshold);

          for (const obj of detection.objects) {
            if (obj.confidence < confThreshold) continue;

            relevantCount++;
            const meta: TransformMeta = {
              sourceUrl: asset.sourceUrl,
              sourceTitle: asset.sourcePageTitle,
              assetId: asset.id,
              template: 'object-detection',
              relevanceScore: obj.confidence,
              isRelevant: true,
              processedAt: new Date().toISOString(),
              generationMethod: 'llm',
            };

            outputRecords.push({
              image: asset.localPath,
              bbox: obj.bbox,
              category: obj.label,
              confidence: obj.confidence,
              image_width: detection.image_width,
              image_height: detection.image_height,
              _meta: meta,
            } as TransformRecord);
          }

          classifiedCount++;
        } catch (error) {
          console.warn(`YOLO detection failed for ${asset.fileName}:`, error);
          if (options.noFallback) {
            skippedCount++;
            dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
          } else {
            visionFallbackCount++;
            fallbackReasons.generation_failed = (fallbackReasons.generation_failed || 0) + 1;
            // Deterministic fallback
            let dims = { width: 640, height: 480 };
            try {
              dims = await getImageDimensions(fullPath);
            } catch {
              // defaults
            }
            const label = inferLabelFromContext(asset, options.target);
            const meta: TransformMeta = {
              sourceUrl: asset.sourceUrl,
              sourceTitle: asset.sourcePageTitle,
              assetId: asset.id,
              template: 'object-detection',
              relevanceScore: 0.5,
              isRelevant: true,
              processedAt: new Date().toISOString(),
              generationMethod: 'deterministic',
            };
            outputRecords.push({
              image: asset.localPath,
              bbox: [0, 0, dims.width, dims.height],
              category: label,
              confidence: 0.5,
              image_width: dims.width,
              image_height: dims.height,
              _meta: meta,
            } as TransformRecord);
          }
        }

        progressCb?.({
          total: validAssets.length,
          completed: i + 1,
          stage: 'vision',
          message: `YOLO detection: ${i + 1}/${validAssets.length}`,
        });
      }
    } else {
      // VLLM engine via Ollama
      generationStartTime = Date.now();

      progressCb?.({
        total: validAssets.length,
        completed: 0,
        stage: 'vision',
        message: 'Running VLLM object detection...',
      });

      let detections: Map<string, ObjectDetection>;
      try {
        detections = await detectObjects(validAssets, options, progressCb, options._decisionLog);
      } catch (error) {
        if (error instanceof VisionAbortError) {
          detections = error.results as Map<string, ObjectDetection>;
          abortedEarly = true;
        } else {
          console.error('VLLM detection failed:', error);
          detections = new Map();
        }
      }

      for (const asset of validAssets) {
        const detection = detections.get(asset.id);

        if (detection) {
          classifiedCount++;
          for (const obj of detection.objects) {
            if (obj.confidence < options.relevanceThreshold) continue;

            relevantCount++;
            const meta: TransformMeta = {
              sourceUrl: asset.sourceUrl,
              sourceTitle: asset.sourcePageTitle,
              assetId: asset.id,
              template: 'object-detection',
              relevanceScore: obj.confidence,
              isRelevant: true,
              processedAt: new Date().toISOString(),
              generationMethod: 'llm',
            };

            outputRecords.push({
              image: asset.localPath,
              bbox: obj.bbox,
              category: obj.label,
              confidence: obj.confidence,
              image_width: detection.image_width,
              image_height: detection.image_height,
              _meta: meta,
            } as TransformRecord);
          }
        } else if (options.noFallback) {
          skippedCount++;
          dropReasons.no_fallback = (dropReasons.no_fallback || 0) + 1;
        } else {
          // Deterministic fallback — determine why VLLM was skipped
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

          const baseDir = options.assetDir || path.dirname(options.input);
          const fullPath = path.resolve(baseDir, asset.localPath);
          let dims = { width: 640, height: 480 };
          try {
            dims = await getImageDimensions(fullPath);
          } catch {
            // defaults
          }
          const label = inferLabelFromContext(asset, options.target);
          const meta: TransformMeta = {
            sourceUrl: asset.sourceUrl,
            sourceTitle: asset.sourcePageTitle,
            assetId: asset.id,
            template: 'object-detection',
            relevanceScore: 0.5,
            isRelevant: true,
            processedAt: new Date().toISOString(),
            generationMethod: 'deterministic',
          };
          outputRecords.push({
            image: asset.localPath,
            bbox: [0, 0, dims.width, dims.height],
            category: label,
            confidence: 0.5,
            image_width: dims.width,
            image_height: dims.height,
            _meta: meta,
          } as TransformRecord);
        }
      }
    }

    // Check abort flag
    if ((globalThis as unknown as { transformAbortFlag?: boolean }).transformAbortFlag) {
      abortedEarly = true;
    }

    // Stage 3: Deduplication
    let finalRecords = outputRecords;
    if (options.dedupe) {
      finalRecords = deduplicateRecords(finalRecords, ['image', 'bbox', 'category']);
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
        generationDuration: generationStartTime ? Date.now() - generationStartTime : undefined,
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
