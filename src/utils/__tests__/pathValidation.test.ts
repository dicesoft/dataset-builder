import { describe, it, expect } from 'vitest';
import path from 'path';
import { validatePathBoundary } from '../pathValidation';
import { CLIError } from '../errorCodes';

describe('validatePathBoundary', () => {
  const root = path.resolve('/test/root');

  it('should return resolved path for valid paths within root', () => {
    const result = validatePathBoundary(path.join(root, 'subdir', 'file.txt'), root);
    expect(result).toBe(path.resolve(root, 'subdir', 'file.txt'));
  });

  it('should allow path equal to root itself', () => {
    const result = validatePathBoundary(root, root);
    expect(result).toBe(path.resolve(root));
  });

  it('should throw CLIError for ../ traversal escaping root', () => {
    const malicious = path.join(root, '..', 'outside', 'file.txt');
    expect(() => validatePathBoundary(malicious, root)).toThrow(CLIError);
    try {
      validatePathBoundary(malicious, root);
    } catch (err) {
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe('INVALID_INPUT');
    }
  });

  it('should throw CLIError for absolute paths outside root', () => {
    const outsidePath = path.resolve('/completely/different/path');
    expect(() => validatePathBoundary(outsidePath, root)).toThrow(CLIError);
  });

  it('should handle deeply nested valid paths', () => {
    const deepPath = path.join(root, 'a', 'b', 'c', 'd', 'file.txt');
    const result = validatePathBoundary(deepPath, root);
    expect(result).toBe(path.resolve(deepPath));
  });

  it('should handle paths with forward slashes on Windows', () => {
    // path.resolve normalizes slashes, so forward slashes should work
    const forwardSlashPath = root + '/subdir/file.txt';
    const result = validatePathBoundary(forwardSlashPath, root);
    expect(result).toBe(path.resolve(root, 'subdir', 'file.txt'));
  });

  it('should reject path that starts with root name but is a different directory', () => {
    // e.g., /test/root-other should not pass for root /test/root
    const sibling = root + '-other';
    expect(() => validatePathBoundary(sibling, root)).toThrow(CLIError);
  });
});
