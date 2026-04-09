import { describe, it, expect } from 'vitest';
import { relativizePath } from './paths';

describe('relativizePath', () => {
  describe('absolute to relative conversion', () => {
    it('strips Unix root directory prefix', () => {
      expect(relativizePath('/home/user/output/data.json', '/home/user/output')).toBe('data.json');
    });

    it('strips Unix root with nested path', () => {
      expect(relativizePath('/home/user/output/sub/data.json', '/home/user/output')).toBe(
        'sub/data.json'
      );
    });

    it('strips Windows drive-letter root', () => {
      expect(relativizePath('D:\\Projects\\output\\data.json', 'D:\\Projects\\output')).toBe(
        'data.json'
      );
    });

    it('strips Windows root with nested path', () => {
      expect(relativizePath('D:\\Projects\\output\\sub\\data.json', 'D:\\Projects\\output')).toBe(
        'sub/data.json'
      );
    });

    it('handles case-insensitive comparison for Windows paths', () => {
      expect(relativizePath('C:\\Users\\Output\\data.json', 'c:\\users\\output')).toBe('data.json');
    });

    it('returns "." when path equals root', () => {
      expect(relativizePath('/home/user/output', '/home/user/output')).toBe('.');
    });
  });

  describe('already-relative passthrough', () => {
    it('passes through relative paths unchanged', () => {
      expect(relativizePath('sub/data.json', '/home/user/output')).toBe('sub/data.json');
    });

    it('passes through relative path with dot prefix', () => {
      expect(relativizePath('./data.json', '/home/user/output')).toBe('./data.json');
    });

    it('normalizes backslashes in relative paths', () => {
      expect(relativizePath('sub\\data.json', '/home/user/output')).toBe('sub/data.json');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for null path', () => {
      expect(relativizePath(null, '/root')).toBe('');
    });

    it('returns empty string for undefined path', () => {
      expect(relativizePath(undefined, '/root')).toBe('');
    });

    it('returns empty string for empty string path', () => {
      expect(relativizePath('', '/root')).toBe('');
    });

    it('returns normalized path when rootDir is null', () => {
      expect(relativizePath('/home/user/data.json', null)).toBe('/home/user/data.json');
    });

    it('returns normalized path when rootDir is undefined', () => {
      expect(relativizePath('D:\\data.json', undefined)).toBe('D:/data.json');
    });

    it('returns path unchanged when it does not start with rootDir', () => {
      expect(relativizePath('/other/path/data.json', '/home/user/output')).toBe(
        '/other/path/data.json'
      );
    });

    it('handles root with trailing slash', () => {
      expect(relativizePath('/home/user/output/data.json', '/home/user/output/')).toBe('data.json');
    });

    it('does not false-match partial directory names', () => {
      // /home/user/output-extra should NOT match /home/user/output
      expect(relativizePath('/home/user/output-extra/data.json', '/home/user/output')).toBe(
        '/home/user/output-extra/data.json'
      );
    });
  });

  describe('cross-platform normalization', () => {
    it('normalizes all backslashes to forward slashes', () => {
      expect(relativizePath('C:\\Users\\test\\output\\file.json', 'C:\\Users\\test\\output')).toBe(
        'file.json'
      );
    });

    it('handles mixed separators', () => {
      expect(relativizePath('C:\\Users/test\\output/file.json', 'C:/Users\\test/output')).toBe(
        'file.json'
      );
    });
  });
});
