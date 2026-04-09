import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

// We need to test readStdin with mocked process.stdin
describe('stdin', () => {
  const originalStdin = process.stdin;

  afterEach(() => {
    // Restore original stdin
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });
  });

  it('should return null when stdin is a TTY', async () => {
    // Mock stdin as TTY
    const mockStdin = new Readable({ read() {} }) as typeof process.stdin;
    Object.defineProperty(mockStdin, 'isTTY', { value: true, writable: true });
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

    // Re-import to pick up mocked stdin
    const { readStdin } = await import('../stdin');
    const result = await readStdin();
    expect(result).toBeNull();
  });

  it('should read JSON data from piped stdin', async () => {
    const testData = '{"search":"cats","count":10}';
    const mockStdin = new Readable({
      read() {
        this.push(testData);
        this.push(null); // signal end
      },
    }) as typeof process.stdin;
    Object.defineProperty(mockStdin, 'isTTY', { value: false, writable: true });
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

    const { readStdin } = await import('../stdin');
    const result = await readStdin();
    expect(result).toBe(testData);
  });

  it('should return null for empty stdin', async () => {
    const mockStdin = new Readable({
      read() {
        this.push(null); // signal end immediately with no data
      },
    }) as typeof process.stdin;
    Object.defineProperty(mockStdin, 'isTTY', { value: false, writable: true });
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

    const { readStdin } = await import('../stdin');
    const result = await readStdin();
    expect(result).toBeNull();
  });

  it('should trim whitespace from stdin data', async () => {
    const testData = '  {"key":"value"}  \n';
    const mockStdin = new Readable({
      read() {
        this.push(testData);
        this.push(null);
      },
    }) as typeof process.stdin;
    Object.defineProperty(mockStdin, 'isTTY', { value: false, writable: true });
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

    const { readStdin } = await import('../stdin');
    const result = await readStdin();
    expect(result).toBe('{"key":"value"}');
  });
});
