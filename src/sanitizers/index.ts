import { dedupeByUrl } from '../formatters/cleanup/dedupe';

export interface CleanOptions {
  dedupe?: boolean;
  trim?: boolean;
  lowercase?: boolean;
  removeEmpty?: boolean;
  normalizeNewlines?: boolean;
}

export function cleanData(data: unknown[], options: CleanOptions): unknown[] {
  let result = [...data];

  // Remove duplicates
  if (options.dedupe) {
    // Try URL-based deduplication first (more reliable for scraped data)
    const first = data[0] as Record<string, unknown>;

    // Check for common URL fields in scraped data
    if (first && typeof first === 'object') {
      const urlField =
        typeof first.url === 'string' && first.url.startsWith('http')
          ? 'url'
          : typeof first.source_url === 'string' && first.source_url.startsWith('http')
            ? 'source_url'
            : null;

      if (urlField) {
        result = dedupeByUrl(result, urlField, true);
        console.log(`Deduplicated by ${urlField} field`);
      } else {
        // Fall back to full record comparison
        const seen = new Set<string>();
        result = result.filter((item) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    }
  }

  // Clean each record
  result = result.map((item) => cleanRecord(item, options));

  // Remove empty records
  if (options.removeEmpty) {
    result = result.filter((item) => !isEmpty(item));
  }

  return result;
}

function cleanRecord(item: unknown, options: CleanOptions): unknown {
  if (item === null || item === undefined) {
    return item;
  }

  if (typeof item === 'string') {
    let value = item;

    if (options.normalizeNewlines) {
      value = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    if (options.trim) {
      value = value.trim();
    }

    if (options.lowercase) {
      value = value.toLowerCase();
    }

    return value;
  }

  if (Array.isArray(item)) {
    return item.map((elem) => cleanRecord(elem, options));
  }

  if (typeof item === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      const cleanedKey = options.trim ? key.trim() : key;
      const cleanedValue = cleanRecord(value, options);

      // Remove empty if option is set
      if (options.removeEmpty && isEmpty(cleanedValue)) {
        continue;
      }

      cleaned[cleanedKey] = cleanedValue;
    }
    return cleaned;
  }

  return item;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

// Utility functions for common cleaning operations
export function removeSpecialChars(text: string, keepSpaces = true): string {
  const pattern = keepSpaces ? /[^a-zA-Z0-9\s]/g : /[^a-zA-Z0-9]/g;
  return text.replace(pattern, '');
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function removeHTMLTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function sanitizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
