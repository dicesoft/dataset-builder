/**
 * Deterministic utilities for transform command (no LLM required)
 * Fast, rule-based filtering and processing
 */

import { AssetRecord, ScrapedPage, QAPair, FilterReasons } from './types';
import { TransformDecisionLog } from './decision-log';

/** Junk patterns for filtering irrelevant assets */
export const JUNK_PATTERNS = [
  /icon/i,
  /logo/i,
  /favicon/i,
  /loading/i,
  /spinner/i,
  /avatar/i,
  /badge/i,
  /banner/i,
  /ad[_-]/i,
  /tracking/i,
  /pixel/i,
  /beacon/i,
  /analytics/i,
  /social/i,
  /share/i,
  /like/i,
  /tweet/i,
  /facebook/i,
  /instagram/i,
  /linkedin/i,
  /pinterest/i,
  /thumb/i,
  /thumbnail/i,
  /placeholder/i,
  /dummy/i,
  /sample/i,
  /test/i,
  /temp/i,
  /cache/i,
];

/** File extensions considered junk */
export const JUNK_EXTENSIONS = ['.svg', '.ico', '.cur'];

/** Boilerplate patterns for text cleanup */
const BOILERPLATE_PATTERNS = [
  // Cookie banners and consent
  /choose which cookies.*?(?=\n\n|\n[A-Z]|$)/gis,
  /accept all cookies.*?(?=\n\n|$)/gis,
  /cookie consent.*?(?=\n\n|$)/gis,
  /privacy settings.*?(?=\n\n|$)/gis,
  /we use cookies.*?(?=\n\n|$)/gis,
  /this website uses cookies.*?(?=\n\n|$)/gis,

  // Privacy policy and terms
  /privacy policy.*?terms of (use|service).*?(?=\n\n|$)/gis,
  /terms of (use|service).*?(?=\n\n|$)/gis,
  /all rights reserved.*?\d{4}.*?(?=\n\n|$)/gis,
  /copyright \u00a9?\s*\d{4}.*?all rights reserved/gi,
  /\u00a9\s*\d{4}.*?(?=\n\n|$)/gis,

  // Newsletter and subscription
  /subscribe to our newsletter.*?(?=\n\n|$)/gis,
  /sign up for our newsletter.*?(?=\n\n|$)/gis,
  /join our mailing list.*?(?=\n\n|$)/gis,
  /get the latest updates.*?(?=\n\n|$)/gis,
  /stay connected.*?(?=\n\n|$)/gis,

  // Social media
  /follow us on (?:twitter|facebook|instagram|linkedin|youtube|tiktok).*?(?=\n\n|$)/gis,
  /connect with us.*?(?:twitter|facebook|instagram|linkedin).*?(?=\n\n|$)/gis,
  /share this (?:article|post|page).*?(?=\n\n|$)/gis,
  /share on (?:twitter|facebook|linkedin).*?(?=\n\n|$)/gis,

  // Navigation and breadcrumbs
  /\^\s*home\s*[\/>\u00bb].*$/gim,
  /^\s*menu\s*$/gim,
  /^\s*search\s*$/gim,
  /^\s*skip to content\s*$/gim,
  /^\s*skip to main content\s*$/gim,

  // Related content and comments
  /related (?:articles|posts|stories|content).*$/gis,
  /you may also like.*$/gis,
  /recommended for you.*$/gis,
  /comments?\s*\(\d+\).*$/gis,
  /leave a comment.*$/gis,
  /add your comment.*$/gis,

  // Footer common text
  /powered by.*?(?=\n\n|$)/gis,
  /built with.*?(?=\n\n|$)/gis,
  /made with.*?(love|\u2665).*?(?=\n\n|$)/gis,

  // ArXiv boilerplate
  /arXivLabs is a framework that allows collaborators/i,
];

/**
 * Check if an asset is likely junk based on rules
 */
export function isJunkAsset(asset: AssetRecord): boolean {
  const fileName = asset.fileName.toLowerCase();
  const sourceUrl = asset.sourceUrl.toLowerCase();

  // Check file size (icons are typically small)
  if (asset.fileSize < 5000) {
    return true;
  }

  // Check file extensions
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  if (JUNK_EXTENSIONS.includes(ext)) {
    return true;
  }

  // Small GIFs are likely animated spinners
  if (fileName.endsWith('.gif') && asset.fileSize < 50000) {
    return true;
  }

  // Check filename patterns
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(fileName) || pattern.test(sourceUrl)) {
      return true;
    }
  }

  // Check alt text if available
  if (asset.context.altText) {
    const altLower = asset.context.altText.toLowerCase();
    for (const pattern of JUNK_PATTERNS) {
      if (pattern.test(altLower)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Remove boilerplate text from scraped content
 */
export function removeBoilerplate(text: string): string {
  let cleaned = text;

  // Apply all boilerplate patterns
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up excessive whitespace
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines to double
    .replace(/[ \t]{2,}/g, ' ') // Collapse multiple spaces/tabs (not newlines)
    .trim();

  return cleaned;
}

/**
 * Extract meaningful label from asset context
 */
export function inferLabelFromContext(asset: AssetRecord, target?: string): string {
  // 1. Try URL path segments
  try {
    const url = new URL(asset.sourceUrl);
    const pathSegments = url.pathname
      .split('/')
      .filter((s) => s.length > 2 && !s.includes('.'))
      .map((s) => s.replace(/-/g, ' ').replace(/_/g, ' '));

    if (pathSegments.length > 0) {
      return pathSegments.slice(-2).join(' ');
    }
  } catch {
    // Invalid URL, continue to next method
  }

  // 2. Try page title keywords
  if (asset.sourcePageTitle) {
    const words = asset.sourcePageTitle
      .split(/[\s|—\-:,]+/)
      .filter((w) => w.length > 3)
      .slice(0, 3);
    if (words.length > 0) {
      return words.join(' ');
    }
  }

  // 3. Use target if provided
  if (target) {
    return target;
  }

  // 4. Default fallback
  return 'uncategorized';
}

/**
 * Calculate deterministic relevance using keyword matching
 */
export function deterministicRelevance(text: string, target: string): number {
  if (!target || !text) {
    return 0;
  }

  const targetWords = target
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (targetWords.length === 0) {
    return 0;
  }

  const textLower = text.toLowerCase();
  let matches = 0;

  for (const word of targetWords) {
    if (textLower.includes(word)) {
      matches++;
    }
  }

  // Also check for exact phrase match (higher weight)
  if (textLower.includes(target.toLowerCase())) {
    matches += targetWords.length;
  }

  // Normalize to 0-1 range, cap at 1.0
  return Math.min(matches / targetWords.length, 1);
}

/**
 * Generate deterministic Q&A from title and text
 */
export function deterministicQA(title: string, text: string): QAPair {
  // Clean up title for question
  const cleanTitle = title
    .replace(/\s*[-|]\s*.*/g, '') // Remove site name after dash/pipe
    .replace(/\s+/g, ' ')
    .trim();

  // Generate question from title
  const instruction = `What is ${cleanTitle}?`;

  // Get first substantial paragraph as answer
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 50);

  let output: string;
  if (paragraphs.length > 0) {
    output = paragraphs[0];
  } else {
    // Fallback to first 500 chars
    output = text.trim().slice(0, 500);
    if (text.length > 500) {
      output += '...';
    }
  }

  return { instruction, output };
}

/**
 * Check if text is likely valid content (not just noise)
 */
export function isValidContent(text: string, minLength: number, maxLength: number): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const trimmed = text.trim();

  // Check length constraints
  if (trimmed.length < minLength) {
    return false;
  }
  if (maxLength > 0 && trimmed.length > maxLength) {
    return false;
  }

  // Check for high ratio of non-word characters (likely garbage)
  const wordChars = (trimmed.match(/\w/g) || []).length;
  const totalChars = trimmed.length;
  if (totalChars > 0 && wordChars / totalChars < 0.3) {
    return false;
  }

  return true;
}

/**
 * Extract tags from page title and URL
 */
export function extractTags(pageTitle: string, url: string): string[] {
  const tags: string[] = [];

  // Extract from URL path
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter((s) => s.length > 2 && !s.includes('.'));
    tags.push(...pathSegments.map((s) => s.replace(/-/g, ' ').replace(/_/g, ' ').toLowerCase()));
  } catch {
    // Invalid URL, skip
  }

  // Extract from title (meaningful words)
  if (pageTitle) {
    const titleWords = pageTitle
      .split(/[\s|—\-:,]+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 3 && !isCommonStopWord(w));
    tags.push(...titleWords.slice(0, 5));
  }

  // Remove duplicates and return
  return [...new Set(tags)];
}

/**
 * Common stop words to filter from tags
 */
function isCommonStopWord(word: string): boolean {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'are',
    'but',
    'not',
    'you',
    'all',
    'can',
    'had',
    'her',
    'was',
    'one',
    'our',
    'out',
    'day',
    'get',
    'has',
    'him',
    'his',
    'how',
    'man',
    'new',
    'now',
    'old',
    'see',
    'two',
    'way',
    'who',
    'boy',
    'did',
    'its',
    'let',
    'put',
    'say',
    'she',
    'too',
    'use',
    'that',
    'with',
    'have',
    'this',
    'will',
    'your',
    'from',
    'they',
    'know',
    'want',
    'been',
    'good',
    'much',
    'some',
    'time',
    'very',
    'when',
    'come',
    'here',
    'just',
    'like',
    'long',
    'make',
    'many',
    'over',
    'such',
    'take',
    'than',
    'them',
    'well',
    'were',
  ]);
  return stopWords.has(word);
}

/**
 * Compute hash for deduplication
 */
export function computeHash(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  return Buffer.from(str).toString('base64').slice(0, 32);
}

/**
 * Deduplicate records by hash
 */
export function deduplicateRecords<T>(records: T[], keyFields?: string[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const record of records) {
    let hash: string;
    if (keyFields && keyFields.length > 0) {
      // Hash only specified fields
      const subset: Record<string, unknown> = {};
      const obj = record as Record<string, unknown>;
      for (const field of keyFields) {
        subset[field] = obj[field];
      }
      hash = computeHash(subset);
    } else {
      hash = computeHash(record);
    }

    if (!seen.has(hash)) {
      seen.add(hash);
      result.push(record);
    }
  }

  return result;
}

/**
 * Detect duplicate content among scraped pages
 * Compares .text fields for identical or near-identical content
 */
export function detectDuplicateContent(pages: ScrapedPage[]): {
  duplicateRate: number;
  duplicateCount: number;
} {
  if (pages.length <= 1) {
    return { duplicateRate: 0, duplicateCount: 0 };
  }

  // Normalize text for comparison (trim, collapse whitespace)
  const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

  const normalized = pages.map((p) => normalize(p.text));
  const seen = new Map<string, number>(); // text -> count

  for (const text of normalized) {
    seen.set(text, (seen.get(text) || 0) + 1);
  }

  // Count records that are duplicates (appear more than once)
  let duplicateCount = 0;
  for (const count of seen.values()) {
    if (count > 1) {
      duplicateCount += count;
    }
  }

  return {
    duplicateRate: duplicateCount / pages.length,
    duplicateCount,
  };
}

/** Filter result with filtered-out pages info */
export interface FilterResult {
  /** Pages that passed filtering */
  validPages: ScrapedPage[];
  /** Total filtered count */
  filteredCount: number;
  /** Breakdown of filter reasons */
  reasons: {
    invalidUrl: number;
    invalidTitle: number;
    textTooShort: number;
    textTooLong: number;
    lowWordRatio: number;
    missingText: number;
  };
  /** Details of filtered pages (for verbose logging) */
  filteredDetails: Array<{
    id: string;
    url: string;
    title: string;
    reason: string;
  }>;
}

/**
 * Filter scraped pages for valid content with detailed reason tracking
 */
export function filterScrapedPages(
  pages: ScrapedPage[],
  minLength: number,
  maxLength: number,
  verbose: boolean = false
): FilterResult {
  const validPages: ScrapedPage[] = [];
  const filteredDetails: Array<{ id: string; url: string; title: string; reason: string }> = [];
  const reasons = {
    invalidUrl: 0,
    invalidTitle: 0,
    textTooShort: 0,
    textTooLong: 0,
    lowWordRatio: 0,
    missingText: 0,
  };

  for (const page of pages) {
    // Must have valid URL
    if (!page.source_url || !page.source_url.startsWith('http')) {
      reasons.invalidUrl++;
      if (verbose) {
        filteredDetails.push({
          id: page.id,
          url: page.source_url || '(none)',
          title: page.title || '(none)',
          reason: 'invalid_url',
        });
      }
      continue;
    }

    // Must have valid title
    if (!page.title || page.title.trim().length < 3) {
      reasons.invalidTitle++;
      if (verbose) {
        filteredDetails.push({
          id: page.id,
          url: page.source_url,
          title: page.title || '(none)',
          reason: 'invalid_title',
        });
      }
      continue;
    }

    // Text must exist and be a string
    if (!page.text || typeof page.text !== 'string') {
      reasons.missingText++;
      if (verbose) {
        filteredDetails.push({
          id: page.id,
          url: page.source_url,
          title: page.title,
          reason: 'missing_text',
        });
      }
      continue;
    }

    const trimmed = page.text.trim();

    // Check minimum length
    if (trimmed.length < minLength) {
      reasons.textTooShort++;
      if (verbose) {
        filteredDetails.push({
          id: page.id,
          url: page.source_url,
          title: page.title,
          reason: `text_too_short (${trimmed.length} < ${minLength})`,
        });
      }
      continue;
    }

    // Check maximum length
    if (maxLength > 0 && trimmed.length > maxLength) {
      reasons.textTooLong++;
      if (verbose) {
        filteredDetails.push({
          id: page.id,
          url: page.source_url,
          title: page.title,
          reason: `text_too_long (${trimmed.length} > ${maxLength})`,
        });
      }
      continue;
    }

    // Check for high ratio of non-word characters (likely garbage)
    const wordChars = (trimmed.match(/\w/g) || []).length;
    const totalChars = trimmed.length;
    if (totalChars > 0 && wordChars / totalChars < 0.3) {
      reasons.lowWordRatio++;
      if (verbose) {
        filteredDetails.push({
          id: page.id,
          url: page.source_url,
          title: page.title,
          reason: 'low_word_ratio (< 30% alphanumeric)',
        });
      }
      continue;
    }

    validPages.push(page);
  }

  return {
    validPages,
    filteredCount: pages.length - validPages.length,
    reasons,
    filteredDetails,
  };
}

/**
 * Filter asset records for valid files
 */
export function filterAssets(
  assets: AssetRecord[],
  excludeJunk: boolean = true,
  decisionLog?: TransformDecisionLog
): AssetRecord[] {
  return assets.filter((asset) => {
    // Must have completed status
    if (asset.status !== 'completed') {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'filter',
        action: 'drop',
        reason: `failed_status: ${asset.status}`,
        details: { status: asset.status },
      });
      return false;
    }

    // Must have valid local path
    if (!asset.localPath) {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'filter',
        action: 'drop',
        reason: 'missing_local_path',
      });
      return false;
    }

    // Check for junk if enabled
    if (excludeJunk && isJunkAsset(asset)) {
      decisionLog?.log({
        recordId: asset.id,
        stage: 'filter',
        action: 'drop',
        reason: 'junk_pattern_matched',
        details: { fileName: asset.fileName },
      });
      return false;
    }

    decisionLog?.log({
      recordId: asset.id,
      stage: 'filter',
      action: 'keep',
      reason: 'passed_all_filters',
    });
    return true;
  });
}
