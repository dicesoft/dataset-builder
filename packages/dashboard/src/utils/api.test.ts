import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from './api';

/**
 * T091: Tests for the API fetch wrapper utility
 */

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function envelope<T>(data: T, success = true, error?: { code: string; message: string }) {
  return {
    version: 1,
    success,
    data: success ? data : undefined,
    error: success ? undefined : error,
  };
}

describe('API utility', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('apiGet', () => {
    it('unwraps envelope data on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope({ items: [1, 2, 3] })),
      });

      const result = await apiGet<{ items: number[] }>('/api/v1/test');

      expect(result).toEqual({ items: [1, 2, 3] });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/test',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('includes Content-Type: application/json header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(null)),
      });

      await apiGet('/api/v1/test');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('throws ApiError on failure envelope', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve(envelope(null, false, { code: 'INVALID_INPUT', message: 'Bad input' })),
      });

      await expect(apiGet('/api/v1/test')).rejects.toThrow(ApiError);
      await expect(apiGet('/api/v1/test')).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'Bad input',
      });
    });

    it('throws ApiError with HTTP status code when no error in envelope', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ version: 1, success: false }),
      });

      await expect(apiGet('/api/v1/test')).rejects.toMatchObject({
        code: 'HTTP_500',
      });
    });
  });

  describe('apiPost', () => {
    it('sends JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope({ id: '123' })),
      });

      await apiPost('/api/v1/jobs', { command: 'scrape' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ command: 'scrape' });
    });

    it('sends no body when payload is undefined', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(null)),
      });

      await apiPost('/api/v1/health/refresh');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.body).toBeUndefined();
    });
  });

  describe('apiPatch', () => {
    it('sends PATCH request with body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope({ updated: true })),
      });

      await apiPatch('/api/v1/config', { outputDir: './out' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toEqual({ outputDir: './out' });
    });
  });

  describe('apiDelete', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope({ deleted: true })),
      });

      await apiDelete('/api/v1/jobs/abc');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('DELETE');
    });
  });

  describe('base URL', () => {
    it('uses empty base URL by default (relative paths)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(envelope(null)),
      });

      await apiGet('/api/v1/health');

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/health', expect.anything());
    });
  });
});
