import { describe, it, expect } from 'vitest';
import { generateSpider } from '../runner';

describe('generateSpider text extraction', () => {
  const spiderCode = generateSpider('test_spider', 'https://arxiv.org/abs/2301.00001', 1);

  describe('text extraction uses .getall() pattern', () => {
    it('should use .getall() + join instead of .get() for text extraction', () => {
      expect(spiderCode).toContain('".join(el.css("::text").getall())');
    });

    it('should NOT use .get() for text extraction', () => {
      // The only .get() calls should be for non-text extraction (e.g., ad filtering, parent checks)
      // The text extraction line itself must use .getall()
      const lines = spiderCode.split('\n');
      const textExtractionLine = lines.find((l) => l.includes('txt =') && l.includes('::text'));
      expect(textExtractionLine).toBeDefined();
      expect(textExtractionLine).toContain('.getall()');
      expect(textExtractionLine).not.toMatch(/\.get\(\s*""\s*\)/);
    });
  });

  describe('content_selectors include arxiv selectors', () => {
    it('should include blockquote.abstract selector', () => {
      expect(spiderCode).toContain('"blockquote.abstract"');
    });

    it('should include #abs selector', () => {
      expect(spiderCode).toContain('"#abs"');
    });

    it('should place arxiv selectors before generic selectors', () => {
      const blockquoteIdx = spiderCode.indexOf('"blockquote.abstract"');
      const pIdx = spiderCode.indexOf('"p"');
      expect(blockquoteIdx).toBeLessThan(pIdx);

      const absIdx = spiderCode.indexOf('"#abs"');
      expect(absIdx).toBeLessThan(pIdx);
    });
  });

  describe('existing selectors still present', () => {
    it('should still include standard content selectors', () => {
      const expectedSelectors = [
        '"p"',
        '"h1"',
        '"h2"',
        '"h3"',
        '"article"',
        '"section"',
        '"main"',
        '"#content"',
        '"#main"',
      ];
      for (const sel of expectedSelectors) {
        expect(spiderCode).toContain(sel);
      }
    });

    it('should still include class-based content selectors', () => {
      expect(spiderCode).toContain('".content"');
      expect(spiderCode).toContain('".article"');
      expect(spiderCode).toContain('".post"');
    });
  });

  describe('spider structure', () => {
    it('should generate a valid Python spider class', () => {
      expect(spiderCode).toContain('class test_spiderSpider(scrapy.Spider)');
      expect(spiderCode).toContain('import scrapy');
      expect(spiderCode).toContain('def parse(self, response)');
    });

    it('should include the target URL', () => {
      expect(spiderCode).toContain('https://arxiv.org/abs/2301.00001');
    });
  });
});
