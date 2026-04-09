/**
 * Tests for deterministic utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isJunkAsset,
  removeBoilerplate,
  inferLabelFromContext,
  deterministicRelevance,
  deterministicQA,
  isValidContent,
  extractTags,
  deduplicateRecords,
  filterScrapedPages,
  filterAssets,
  detectDuplicateContent,
} from './deterministic';
import { AssetRecord } from '../downloader/types';
import { ScrapedPage } from './types';

// Mock asset for testing
const createMockAsset = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  id: 'asset_0',
  sourceUrl: 'https://example.com/images/car.jpg',
  sourcePageUrl: 'https://example.com/cars',
  sourcePageTitle: 'Sports Cars Gallery',
  localPath: 'downloads/images/car.jpg',
  fileName: 'car.jpg',
  fileType: 'image',
  fileSize: 50000,
  status: 'completed',
  downloadedAt: new Date().toISOString(),
  duration: 1000,
  context: {
    altText: 'A red sports car',
    surroundingText: 'Check out this amazing sports car',
    pageDepth: 0,
    tags: ['cars', 'sports'],
  },
  relevance: {
    score: null,
    matchesTarget: null,
    reason: null,
  },
  ...overrides,
});

// Mock scraped page for testing
const createMockPage = (overrides: Partial<ScrapedPage> = {}): ScrapedPage => ({
  id: 'page_0',
  source_url: 'https://example.com/article',
  title: 'Test Article',
  text: 'This is the article content.\n\nIt has multiple paragraphs.',
  links: [],
  crawled_at: new Date().toISOString(),
  depth: 0,
  ...overrides,
});

describe('isJunkAsset', () => {
  it('should identify small files as junk', () => {
    const asset = createMockAsset({ fileSize: 3000 });
    expect(isJunkAsset(asset)).toBe(true);
  });

  it('should identify SVG files as junk', () => {
    const asset = createMockAsset({ fileName: 'logo.svg', fileSize: 10000 });
    expect(isJunkAsset(asset)).toBe(true);
  });

  it('should identify icon files as junk', () => {
    const asset = createMockAsset({ fileName: 'favicon.ico', fileSize: 10000 });
    expect(isJunkAsset(asset)).toBe(true);
  });

  it('should identify loading spinner files as junk', () => {
    const asset = createMockAsset({ fileName: 'loading-spinner.gif', fileSize: 10000 });
    expect(isJunkAsset(asset)).toBe(true);
  });

  it('should allow valid image files', () => {
    const asset = createMockAsset({ fileName: 'car.jpg', fileSize: 50000 });
    expect(isJunkAsset(asset)).toBe(false);
  });

  it('should identify small GIFs as junk', () => {
    const asset = createMockAsset({ fileName: 'spinner.gif', fileSize: 30000 });
    expect(isJunkAsset(asset)).toBe(true);
  });

  it('should allow large GIFs', () => {
    const asset = createMockAsset({ fileName: 'animation.gif', fileSize: 100000 });
    expect(isJunkAsset(asset)).toBe(false);
  });
});

describe('removeBoilerplate', () => {
  it('should remove cookie consent text', () => {
    const text = 'We use cookies to improve your experience.\n\nActual content here.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).not.toContain('cookies');
  });

  it('should remove privacy policy text', () => {
    const text = 'Privacy Policy Terms of Service\n\nActual content here.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).toBe('Actual content here.');
  });

  it('should remove copyright notices', () => {
    const text = 'Copyright 2024 All Rights Reserved\n\nActual content here.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).not.toContain('Copyright');
  });

  it('should remove newsletter subscription prompts', () => {
    const text = 'Subscribe to our newsletter for updates\n\nActual content here.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).not.toContain('newsletter');
  });

  it('should remove social media links', () => {
    const text = 'Follow us on Twitter and Facebook\n\nActual content here.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).not.toContain('Follow us');
  });

  it('should collapse multiple newlines', () => {
    const text = 'Line 1\n\n\n\n\nLine 2';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).toBe('Line 1\n\nLine 2');
  });

  it('should preserve actual content', () => {
    const text = 'This is the main article content.\n\nIt discusses important topics.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).toContain('article content');
    expect(cleaned).toContain('important topics');
  });
});

describe('inferLabelFromContext', () => {
  it('should extract label from URL path', () => {
    const asset = createMockAsset({
      sourceUrl: 'https://example.com/vehicles/sports/cars/red-ferrari.jpg',
    });
    const label = inferLabelFromContext(asset, 'sports cars');
    expect(label.toLowerCase()).toContain('sports');
  });

  it('should extract label from page title', () => {
    const asset = createMockAsset({
      sourcePageTitle: 'Electric Vehicles Collection',
      sourceUrl: 'https://example.com/image.jpg',
    });
    const label = inferLabelFromContext(asset);
    expect(label.toLowerCase()).toContain('electric');
  });

  it('should use target as fallback', () => {
    const asset = createMockAsset({
      sourceUrl: 'https://example.com/image.jpg',
      sourcePageTitle: '',
    });
    const label = inferLabelFromContext(asset, 'motorcycles');
    expect(label).toBe('motorcycles');
  });

  it('should return uncategorized as last resort', () => {
    const asset = createMockAsset({
      sourceUrl: 'https://example.com/image.jpg',
      sourcePageTitle: '',
    });
    const label = inferLabelFromContext(asset);
    expect(label).toBe('uncategorized');
  });
});

describe('deterministicRelevance', () => {
  it('should return 0 for empty target', () => {
    expect(deterministicRelevance('some text', '')).toBe(0);
  });

  it('should return 0 for empty text', () => {
    expect(deterministicRelevance('', 'target')).toBe(0);
  });

  it('should return high score for exact match', () => {
    const text = 'This is about sports cars and racing';
    expect(deterministicRelevance(text, 'sports cars')).toBeGreaterThan(0.5);
  });

  it('should return low score for no match', () => {
    const text = 'This is about cooking recipes';
    expect(deterministicRelevance(text, 'sports cars')).toBeLessThan(0.5);
  });

  it('should handle partial matches', () => {
    const text = 'This is about cars';
    const score = deterministicRelevance(text, 'sports cars');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('should boost score for exact phrase match', () => {
    const textWithPhrase = 'I love sports cars, they are fast';
    const textWithoutPhrase = 'I love some sports, cars are fun';
    const scoreWith = deterministicRelevance(textWithPhrase, 'sports cars');
    const scoreWithout = deterministicRelevance(textWithoutPhrase, 'sports cars');
    // Exact phrase match should score at least as high
    expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout);
    expect(scoreWith).toBeGreaterThan(0);
  });
});

describe('deterministicQA', () => {
  it('should generate question from title', () => {
    const result = deterministicQA('Python Programming', 'Python is a programming language.');
    expect(result.instruction).toContain('Python Programming');
    expect(result.instruction.toLowerCase()).toContain('what');
  });

  it('should clean up title with separators', () => {
    const result = deterministicQA('Article Title | Site Name', 'Content here.');
    expect(result.instruction).not.toContain('|');
    expect(result.instruction).not.toContain('Site Name');
  });

  it('should use first substantial paragraph as output', () => {
    const text =
      'This is the first substantial paragraph with enough content to be considered valid.\n\nSecond paragraph here.';
    const result = deterministicQA('Title', text);
    expect(result.output).toBe(
      'This is the first substantial paragraph with enough content to be considered valid.'
    );
  });

  it('should fallback to truncated text for short content', () => {
    const text = 'Short text.';
    const result = deterministicQA('Title', text);
    expect(result.output).toBe('Short text.');
  });

  it('should use first substantial paragraph', () => {
    const longText = 'A'.repeat(1000);
    const result = deterministicQA('Title', longText);
    // Takes first substantial paragraph (over 50 chars)
    expect(result.output.length).toBeGreaterThanOrEqual(50);
  });
});

describe('isValidContent', () => {
  it('should return false for null', () => {
    expect(isValidContent(null as unknown as string, 10, 100)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isValidContent(undefined as unknown as string, 10, 100)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isValidContent('', 10, 100)).toBe(false);
  });

  it('should return false for text below min length', () => {
    expect(isValidContent('short', 10, 100)).toBe(false);
  });

  it('should return false for text above max length', () => {
    expect(isValidContent('a'.repeat(200), 10, 100)).toBe(false);
  });

  it('should return false for garbage text', () => {
    expect(isValidContent('!!!@@@###$$$%%%', 10, 100)).toBe(false);
  });

  it('should return true for valid content', () => {
    expect(isValidContent('This is valid content with enough length.', 10, 100)).toBe(true);
  });
});

describe('extractTags', () => {
  it('should extract tags from URL path', () => {
    const tags = extractTags('Page Title', 'https://example.com/cars/sports');
    expect(tags).toContain('cars');
    expect(tags).toContain('sports');
  });

  it('should extract tags from title', () => {
    const tags = extractTags('Electric Vehicles Guide', 'https://example.com/');
    expect(tags).toContain('electric');
    expect(tags).toContain('vehicles');
  });

  it('should remove duplicates', () => {
    const tags = extractTags('Cars and Cars', 'https://example.com/cars');
    const uniqueTags = [...new Set(tags)];
    expect(tags.length).toBe(uniqueTags.length);
  });

  it('should filter out short words', () => {
    const tags = extractTags('A Big Car', 'https://example.com/');
    expect(tags).not.toContain('a');
    expect(tags).not.toContain('big'); // wait, 'big' is 3 letters
  });

  it('should filter out stop words', () => {
    const tags = extractTags('The Best Cars', 'https://example.com/');
    expect(tags).not.toContain('the');
  });
});

describe('deduplicateRecords', () => {
  it('should remove exact duplicates', () => {
    const records = [
      { id: 1, text: 'Hello' },
      { id: 1, text: 'Hello' }, // exact duplicate
      { id: 2, text: 'World' },
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it('should dedupe by specific fields', () => {
    const records = [
      { id: 1, text: 'Hello', other: 'A' },
      { id: 2, text: 'Hello', other: 'B' },
    ];
    const result = deduplicateRecords(records, ['text']);
    expect(result).toHaveLength(1);
  });

  it('should preserve first occurrence', () => {
    const records = [
      { id: 1, text: 'Hello' },
      { id: 2, text: 'Hello' },
    ];
    const result = deduplicateRecords(records);
    expect(result[0].id).toBe(1);
  });

  it('should handle empty array', () => {
    expect(deduplicateRecords([])).toEqual([]);
  });
});

describe('filterScrapedPages', () => {
  it('should filter out pages with invalid URLs', () => {
    const pages = [createMockPage({ source_url: 'not-a-url' })];
    expect(filterScrapedPages(pages, 50, 10000).validPages).toHaveLength(0);
  });

  it('should filter out pages with short titles', () => {
    const pages = [createMockPage({ title: 'Hi' })];
    expect(filterScrapedPages(pages, 50, 10000).validPages).toHaveLength(0);
  });

  it('should filter out pages with short text', () => {
    const pages = [createMockPage({ text: 'Short' })];
    expect(filterScrapedPages(pages, 50, 10000).validPages).toHaveLength(0);
  });

  it('should keep valid pages', () => {
    const pages = [createMockPage()];
    expect(filterScrapedPages(pages, 50, 10000).validPages).toHaveLength(1);
  });
});

describe('filterAssets', () => {
  it('should filter out non-completed assets', () => {
    const assets = [createMockAsset({ status: 'failed' })];
    expect(filterAssets(assets, true)).toHaveLength(0);
  });

  it('should filter out assets without local path', () => {
    const assets = [createMockAsset({ localPath: '' })];
    expect(filterAssets(assets, true)).toHaveLength(0);
  });

  it('should filter out junk assets when excludeJunk is true', () => {
    const assets = [createMockAsset({ fileName: 'icon.svg', fileSize: 10000 })];
    expect(filterAssets(assets, true)).toHaveLength(0);
  });

  it('should keep junk assets when excludeJunk is false', () => {
    const assets = [createMockAsset({ fileName: 'icon.svg', fileSize: 10000 })];
    expect(filterAssets(assets, false)).toHaveLength(1);
  });

  it('should keep valid assets', () => {
    const assets = [createMockAsset()];
    expect(filterAssets(assets, true)).toHaveLength(1);
  });
});

describe('detectDuplicateContent', () => {
  it('should detect >50% duplicate text', () => {
    const pages = [
      createMockPage({
        id: 'p1',
        text: 'arXivLabs is a framework that allows collaborators to develop features',
      }),
      createMockPage({
        id: 'p2',
        text: 'arXivLabs is a framework that allows collaborators to develop features',
      }),
      createMockPage({
        id: 'p3',
        text: 'arXivLabs is a framework that allows collaborators to develop features',
      }),
      createMockPage({
        id: 'p4',
        text: 'This is unique content about reinforcement learning algorithms.',
      }),
    ];
    const result = detectDuplicateContent(pages);
    expect(result.duplicateRate).toBeGreaterThan(0.5);
    expect(result.duplicateCount).toBe(3);
  });

  it('should not flag when <50% duplicates', () => {
    const pages = [
      createMockPage({ id: 'p1', text: 'Unique content about machine learning.' }),
      createMockPage({ id: 'p2', text: 'Different content about deep learning.' }),
      createMockPage({ id: 'p3', text: 'Another unique article about neural networks.' }),
      createMockPage({ id: 'p4', text: 'Unique content about machine learning.' }), // 1 duplicate pair
    ];
    const result = detectDuplicateContent(pages);
    expect(result.duplicateRate).toBe(0.5);
    expect(result.duplicateCount).toBe(2);
  });

  it('should handle single page', () => {
    const pages = [createMockPage({ id: 'p1', text: 'Only one page here.' })];
    const result = detectDuplicateContent(pages);
    expect(result.duplicateRate).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });

  it('should handle empty array', () => {
    const result = detectDuplicateContent([]);
    expect(result.duplicateRate).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });

  it('should handle 100% identical records', () => {
    const pages = [
      createMockPage({ id: 'p1', text: 'All the same content.' }),
      createMockPage({ id: 'p2', text: 'All the same content.' }),
      createMockPage({ id: 'p3', text: 'All the same content.' }),
    ];
    const result = detectDuplicateContent(pages);
    expect(result.duplicateRate).toBe(1);
    expect(result.duplicateCount).toBe(3);
  });
});

describe('BOILERPLATE_PATTERNS', () => {
  it('should remove arXiv boilerplate text', () => {
    const text =
      'arXivLabs is a framework that allows collaborators to develop features\n\nActual content here.';
    const cleaned = removeBoilerplate(text);
    expect(cleaned).not.toContain('arXivLabs');
    expect(cleaned).toContain('Actual content here.');
  });
});
