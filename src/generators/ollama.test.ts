/**
 * Tests for Ollama client - ModelNotFoundError and ensureModel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaClient, ModelNotFoundError } from './ollama';

// Mock the ollama npm package
const mockPull = vi.fn();
vi.mock('ollama', () => ({
  default: {
    chat: vi.fn(),
    pull: (...args: unknown[]) => mockPull(...args),
  },
}));

// Mock config
vi.mock('../config', () => ({
  getConfig: () => ({
    get: (key: string) => {
      if (key === 'ollamaUrl') return 'http://localhost:11434';
      if (key === 'ollamaModel') return 'llama3';
      return undefined;
    },
  }),
}));

// Mock confirm utility
const mockConfirm = vi.fn();
vi.mock('../utils/confirm', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('ModelNotFoundError', () => {
  it('should have correct name and modelName', () => {
    const error = new ModelNotFoundError('qwen3.5:2b');
    expect(error.name).toBe('ModelNotFoundError');
    expect(error.modelName).toBe('qwen3.5:2b');
    expect(error.message).toContain('qwen3.5:2b');
  });

  it('should be an instance of Error', () => {
    const error = new ModelNotFoundError('test-model');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ModelNotFoundError);
  });
});

describe('OllamaClient.ensureModel', () => {
  let client: OllamaClient;

  beforeEach(() => {
    mockFetch.mockReset();
    mockPull.mockReset();
    mockConfirm.mockReset();
    client = new OllamaClient('http://localhost:11434', 'llama3');
  });

  it('should succeed silently when model exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'llava:latest', modified_at: '', size: 0 }],
      }),
    });

    await expect(client.ensureModel('llava')).resolves.toBeUndefined();
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('should match model with :latest suffix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'llava:latest', modified_at: '', size: 0 }],
      }),
    });

    await expect(client.ensureModel('llava:latest')).resolves.toBeUndefined();
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('should throw ModelNotFoundError when user declines pull', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    // Simulate user declining
    mockConfirm.mockResolvedValueOnce(false);

    await expect(client.ensureModel('nonexistent-model')).rejects.toThrow(ModelNotFoundError);
  });

  it('should auto-pull when skipConfirmation is true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    // Mock pull stream
    mockPull.mockResolvedValueOnce(
      (async function* () {
        yield { status: 'pulling manifest' };
        yield { status: 'success' };
      })()
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.ensureModel('new-model', true);

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockPull).toHaveBeenCalledWith({ model: 'new-model', stream: true });
    logSpy.mockRestore();
  });

  it('should pull when user confirms', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    // Simulate user confirming
    mockConfirm.mockResolvedValueOnce(true);

    // Mock pull stream
    mockPull.mockResolvedValueOnce(
      (async function* () {
        yield { status: 'success' };
      })()
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.ensureModel('new-model');

    expect(mockPull).toHaveBeenCalledWith({ model: 'new-model', stream: true });
    logSpy.mockRestore();
  });

  it('should call confirm with defaultYes=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    // Simulate user confirming
    mockConfirm.mockResolvedValueOnce(true);

    // Mock pull stream
    mockPull.mockResolvedValueOnce(
      (async function* () {
        yield { status: 'success' };
      })()
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await client.ensureModel('new-model');

    expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('new-model'), true);
    logSpy.mockRestore();
  });
});

describe('OllamaClient.chat - not found detection', () => {
  it('should throw ModelNotFoundError when error contains "not found"', async () => {
    const ollama = await import('ollama');
    const mockOllamaChat = vi.mocked(ollama.default.chat);
    mockOllamaChat.mockRejectedValueOnce(new Error('model "qwen3.5:2b" not found'));

    const client = new OllamaClient('http://localhost:11434', 'llama3');

    await expect(
      client.chat({
        model: 'qwen3.5:2b',
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow(ModelNotFoundError);
  });
});

describe('OllamaClient.generate - not found detection', () => {
  it('should throw ModelNotFoundError when response contains "not found"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => 'model "nonexistent" not found, try pulling it first',
    });

    const client = new OllamaClient('http://localhost:11434', 'llama3');

    await expect(
      client.generate({
        model: 'nonexistent',
        prompt: 'hello',
      })
    ).rejects.toThrow(ModelNotFoundError);
  });
});
