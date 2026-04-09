/**
 * Filename sanitization regression tests
 * Bug: URLs with illegal filesystem chars (e.g., * in "0*A7MUqyCLvZDcHkfM.jpg")
 * caused ENOENT crash on Windows when createWriteStream tried to open the path.
 */

import { describe, it, expect } from 'vitest';
import { Downloader } from './index';

// Access private sanitizeFilename via a test subclass
class TestableDownloader extends Downloader {
  public testSanitize(filename: string): string {
    return (this as any).sanitizeFilename(filename);
  }
  public testGetFilename(url: string, type: string): string {
    return (this as any).getFilename(url, type);
  }
}

describe('Downloader filename sanitization', () => {
  const dl = new TestableDownloader({ outputDir: '/tmp/test' });

  describe('sanitizeFilename', () => {
    it('should replace asterisk (*) with underscore', () => {
      expect(dl.testSanitize('0*A7MUqyCLvZDcHkfM.jpg')).toBe('0_A7MUqyCLvZDcHkfM.jpg');
    });

    it('should replace question mark (?)', () => {
      expect(dl.testSanitize('image?.png')).toBe('image_.png');
    });

    it('should replace colon (:)', () => {
      expect(dl.testSanitize('file:name.jpg')).toBe('file_name.jpg');
    });

    it('should replace pipe (|)', () => {
      expect(dl.testSanitize('a|b.jpg')).toBe('a_b.jpg');
    });

    it('should replace angle brackets (< >)', () => {
      expect(dl.testSanitize('<file>.jpg')).toBe('_file_.jpg');
    });

    it('should replace double quotes (")', () => {
      expect(dl.testSanitize('"file".jpg')).toBe('_file_.jpg');
    });

    it('should strip trailing dots and spaces', () => {
      expect(dl.testSanitize('file.jpg...')).toBe('file.jpg');
      expect(dl.testSanitize('file.jpg   ')).toBe('file.jpg');
    });

    it('should leave valid filenames unchanged', () => {
      expect(dl.testSanitize('normal-file_name (1).jpg')).toBe('normal-file_name (1).jpg');
    });

    it('should handle multiple illegal characters', () => {
      expect(dl.testSanitize('a*b?c:d|e<f>g"h.jpg')).toBe('a_b_c_d_e_f_g_h.jpg');
    });

    it('should truncate to 255 characters', () => {
      const long = 'a'.repeat(300) + '.jpg';
      expect(dl.testSanitize(long).length).toBeLessThanOrEqual(255);
    });
  });

  describe('getFilename', () => {
    it('should sanitize filenames from URLs with illegal chars', () => {
      const filename = dl.testGetFilename(
        'https://miro.medium.com/v2/resize:fit:720/0*A7MUqyCLvZDcHkfM.jpg',
        'image'
      );
      expect(filename).not.toContain('*');
      expect(filename).not.toContain(':');
      expect(filename).toMatch(/\.jpg$/);
    });

    it('should handle normal URLs without modification', () => {
      const filename = dl.testGetFilename('https://example.com/images/photo.jpg', 'image');
      expect(filename).toBe('photo.jpg');
    });

    it('should generate fallback name for extensionless URLs', () => {
      const filename = dl.testGetFilename('https://example.com/images/noext', 'image');
      expect(filename).toMatch(/^download_.*\.jpg$/);
    });
  });
});
