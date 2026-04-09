/**
 * Deduplication utilities
 * Remove duplicate records from datasets
 */

import { computeHash } from '../utils';

/**
 * Remove exact duplicates based on field values
 * Uses SHA-256 hash for comparison
 * @param data - Array of records
 * @param fields - Optional fields to compare (compares full record if not specified)
 * @returns Deduplicated array
 */
export function dedupeExact(data: unknown[], fields?: string[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const record of data) {
    let hash: string;

    if (fields?.length) {
      // Hash only specified fields
      const subset: Record<string, unknown> = {};
      const obj = record as Record<string, unknown>;
      for (const field of fields) {
        subset[field] = obj[field];
      }
      hash = computeHash(subset);
    } else {
      // Hash full record
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
 * Remove duplicates based on URL field
 * Useful for scraped data where URL is the unique identifier
 * @param data - Array of records
 * @param urlField - Field containing URL
 * @param normalize - Whether to normalize URLs (remove trailing slashes, etc.)
 * @returns Deduplicated array
 */
export function dedupeByUrl(data: unknown[], urlField: string, normalize = true): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const record of data) {
    const obj = record as Record<string, unknown>;
    let url = String(obj[urlField] || '');

    if (!url) continue;

    if (normalize) {
      url = normalizeUrl(url);
    }

    if (!seen.has(url)) {
      seen.add(url);
      result.push(record);
    }
  }

  return result;
}

/**
 * Normalize URL for comparison
 * Removes common variations that don't change the resource
 * @param url - URL to normalize
 * @returns Normalized URL
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Remove trailing slashes from pathname
    urlObj.pathname = urlObj.pathname.replace(/\/+$/, '');

    // Remove common tracking parameters
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
    ];
    trackingParams.forEach((param) => urlObj.searchParams.delete(param));

    // Sort remaining params for consistency
    urlObj.searchParams.sort();

    // Remove hash fragment (usually client-side only)
    urlObj.hash = '';

    return urlObj.toString().toLowerCase();
  } catch {
    // If URL parsing fails, just lowercase and trim
    return url.toLowerCase().trim();
  }
}

/**
 * Fuzzy deduplication using string similarity
 * Requires Fuse.js to be installed
 * @param data - Array of records
 * @param textField - Field containing text to compare
 * @param threshold - Similarity threshold (0-1, higher = more similar)
 * @returns Deduplicated array
 */
export async function dedupeFuzzy(
  data: unknown[],
  textField: string,
  threshold = 0.8
): Promise<unknown[]> {
  // Note: This is a placeholder for Fuse.js integration
  // The actual implementation would require Fuse.js as an optional dependency
  try {
    // Dynamic import to handle optional dependency
    // @ts-expect-error Fuse.js is an optional dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FuseModule: any = await import('fuse.js');
    const Fuse = FuseModule.default;

    const result: unknown[] = [];
    const texts: string[] = [];

    for (const record of data) {
      const obj = record as Record<string, unknown>;
      const text = String(obj[textField] || '');

      // Check similarity against all existing texts
      const fuse = new Fuse(texts, { threshold, includeScore: true });
      const matches = fuse.search(text);

      // If no similar text found, add to results
      if (matches.length === 0 || (matches[0].score ?? 1) < threshold) {
        texts.push(text);
        result.push(record);
      }
    }

    return result;
  } catch {
    // If Fuse.js is not available, fall back to exact dedupe
    console.warn('Fuse.js not available, falling back to exact deduplication');
    return dedupeExact(data, textField ? [textField] : undefined);
  }
}

/**
 * Find duplicate groups in data
 * Returns groups of records that are duplicates of each other
 * @param data - Array of records
 * @param fields - Optional fields to compare
 * @returns Array of duplicate groups
 */
export function findDuplicateGroups(
  data: unknown[],
  fields?: string[]
): Array<{ index: number; record: unknown }[]> {
  const hashMap = new Map<string, { index: number; record: unknown }[]>();

  for (let i = 0; i < data.length; i++) {
    const record = data[i];
    let hash: string;

    if (fields?.length) {
      const subset: Record<string, unknown> = {};
      const obj = record as Record<string, unknown>;
      for (const field of fields) {
        subset[field] = obj[field];
      }
      hash = computeHash(subset);
    } else {
      hash = computeHash(record);
    }

    const existing = hashMap.get(hash) || [];
    existing.push({ index: i, record });
    hashMap.set(hash, existing);
  }

  // Return only groups with more than 1 item
  return Array.from(hashMap.values()).filter((group) => group.length > 1);
}
