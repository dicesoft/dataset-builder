/**
 * Raw Extract Template
 * Deterministic cleanup only - no LLM calls
 * Best for: Quick cleanup when Ollama unavailable
 */

import {
  TransformTemplate,
  TransformOptions,
  TransformResult,
  TransformProgress,
  TransformRecord,
  TransformMeta,
  ScrapedPage,
  AssetRecord,
} from '../types';
import {
  removeBoilerplate,
  filterScrapedPages,
  filterAssets,
  deduplicateRecords,
  isValidContent,
  FilterResult,
} from '../deterministic';

export const rawExtractTemplate: TransformTemplate = {
  name: 'raw-extract',
  description: 'Clean scraped text with boilerplate removal. Deterministic only, no LLM.',
  supportedInputs: ['text'],
  requiresLlm: false,
  usesVision: false,

  async process(
    records: unknown[],
    options: TransformOptions,
    progressCb?: (progress: TransformProgress) => void
  ): Promise<TransformResult> {
    const startTime = Date.now();

    // Determine input type
    const firstRecord = records[0] as Record<string, unknown>;
    const isScrapedPages = firstRecord?.text !== undefined && firstRecord?.source_url !== undefined;
    const isAssetRecords =
      firstRecord?.fileName !== undefined && firstRecord?.localPath !== undefined;

    let processedRecords: TransformRecord[] = [];
    let inputCount = records.length;
    let filteredCount = 0;
    let filterResult:
      | {
          reasons?: {
            invalidUrl: number;
            invalidTitle: number;
            textTooShort: number;
            textTooLong: number;
            lowWordRatio: number;
            missingText: number;
          };
        }
      | undefined;

    // Report initial progress
    progressCb?.({
      total: inputCount,
      completed: 0,
      stage: 'pre-filtering',
      message: `Starting raw-extract on ${inputCount} records`,
    });

    // Process based on input type
    if (isScrapedPages) {
      const pages = records as ScrapedPage[];

      // Filter valid pages
      const filterRes = filterScrapedPages(
        pages,
        options.minTextLength,
        options.maxTextLength,
        options.verbose
      );
      filterResult = filterRes;
      const validPages = filterRes.validPages;
      filteredCount = filterRes.filteredCount;

      progressCb?.({
        total: inputCount,
        completed: filteredCount,
        stage: 'pre-filtering',
        message: `Filtered ${filteredCount} invalid pages`,
      });

      // Process each page
      for (let i = 0; i < validPages.length; i++) {
        const page = validPages[i];

        // Remove boilerplate
        let text = removeBoilerplate(page.text);

        // Validate final text
        if (!isValidContent(text, options.minTextLength, options.maxTextLength)) {
          filteredCount++;
          continue;
        }

        // Create output record
        const meta: TransformMeta = {
          sourceUrl: page.source_url,
          sourceTitle: page.title,
          template: 'raw-extract',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        processedRecords.push({
          id: page.id,
          source_url: page.source_url,
          title: page.title,
          text: text,
          crawled_at: page.crawled_at,
          depth: page.depth,
          _meta: meta,
        } as TransformRecord);

        progressCb?.({
          total: inputCount,
          completed: i + 1,
          stage: 'extraction',
          message: `Processed ${i + 1}/${validPages.length} pages`,
          estimatedTimeRemaining: Math.round(
            (((Date.now() - startTime) / (i + 1)) * (validPages.length - i - 1)) / 1000
          ),
        });
      }
    } else if (isAssetRecords) {
      const assets = records as AssetRecord[];

      // Filter valid assets
      const validAssets = filterAssets(assets, true, options._decisionLog);
      filteredCount = assets.length - validAssets.length;

      progressCb?.({
        total: inputCount,
        completed: filteredCount,
        stage: 'pre-filtering',
        message: `Filtered ${filteredCount} invalid assets`,
      });

      // Process each asset
      for (let i = 0; i < validAssets.length; i++) {
        const asset = validAssets[i];

        const meta: TransformMeta = {
          sourceUrl: asset.sourceUrl,
          sourceTitle: asset.sourcePageTitle,
          assetId: asset.id,
          template: 'raw-extract',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        processedRecords.push({
          id: asset.id,
          fileName: asset.fileName,
          fileType: asset.fileType,
          fileSize: asset.fileSize,
          localPath: asset.localPath,
          sourceUrl: asset.sourceUrl,
          sourcePageUrl: asset.sourcePageUrl,
          sourcePageTitle: asset.sourcePageTitle,
          tags: asset.context.tags,
          _meta: meta,
        } as TransformRecord);

        progressCb?.({
          total: inputCount,
          completed: i + 1,
          stage: 'extraction',
          message: `Processed ${i + 1}/${validAssets.length} assets`,
        });
      }
    } else {
      // Generic record processing
      for (let i = 0; i < records.length; i++) {
        const record = records[i] as Record<string, unknown>;

        // Clean text fields if present
        const cleaned: Record<string, unknown> = { ...record };
        if (typeof record.text === 'string') {
          cleaned.text = removeBoilerplate(record.text);
        }

        const meta: TransformMeta = {
          sourceUrl: (record.source_url as string) || (record.url as string) || 'unknown',
          template: 'raw-extract',
          processedAt: new Date().toISOString(),
          generationMethod: 'deterministic',
        };

        processedRecords.push({
          ...cleaned,
          _meta: meta,
        } as TransformRecord);

        progressCb?.({
          total: inputCount,
          completed: i + 1,
          stage: 'extraction',
          message: `Processed ${i + 1}/${records.length} records`,
        });
      }
    }

    // Deduplicate if requested
    if (options.dedupe) {
      const beforeDedupe = processedRecords.length;
      processedRecords = deduplicateRecords(processedRecords, ['text']);
      const dedupedCount = beforeDedupe - processedRecords.length;

      progressCb?.({
        total: inputCount,
        completed: processedRecords.length,
        stage: 'deduplication',
        message: `Removed ${dedupedCount} duplicates`,
      });
    }

    const duration = Date.now() - startTime;

    return {
      records: processedRecords,
      stats: {
        inputCount,
        filteredCount,
        filterReasons: isScrapedPages ? filterResult?.reasons : undefined,
        classifiedCount: 0,
        relevantCount: processedRecords.length,
        generatedCount: processedRecords.length,
        outputCount: processedRecords.length,
        errorCount: 0,
        duration,
      },
    };
  },
};
