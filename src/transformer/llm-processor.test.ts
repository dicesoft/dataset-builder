/**
 * Tests for LLM processor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scoreRelevance,
  generateQA,
  generateConversation,
  generateInstruction,
  setTransformAbortFlag,
  LLMAbortError,
  clearPromptCache,
  _tryParseJson,
  QAResultMap,
} from './llm-processor';
import { TransformOptions, TransformProgress } from './types';

import { ModelNotFoundError } from '../generators/ollama';

// Mock the Ollama client
const mockGenerate = vi.fn();
const mockPing = vi.fn();

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../generators/ollama', () => {
  class _ModelNotFoundError extends Error {
    public readonly modelName: string;
    constructor(modelName: string) {
      super(`Model '${modelName}' not found locally`);
      this.name = 'ModelNotFoundError';
      this.modelName = modelName;
    }
  }
  return {
    getOllama: () => ({
      generate: mockGenerate,
      ping: mockPing,
      getDefaultModel: () => 'test-model',
      ensureModel: vi.fn().mockResolvedValue(undefined),
    }),
    extractFinalResponse: (text: string) => text,
    ModelNotFoundError: _ModelNotFoundError,
  };
});

describe('scoreRelevance', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
    verbose: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should score relevance for multiple records', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        scores: [
          { id: '1', score: 0.8, relevant: true, reason: 'Direct match' },
          { id: '2', score: 0.3, relevant: false, reason: 'No match' },
        ],
      }),
    });

    const records = [
      { id: '1', text: 'About sports cars', title: 'Sports Cars' },
      { id: '2', text: 'About cooking', title: 'Recipes' },
    ];

    const results = await scoreRelevance(records, 'sports cars', options);

    expect(results.get('1')?.score).toBe(0.8);
    expect(results.get('2')?.score).toBe(0.3);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors with retry', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('API Error')).mockResolvedValueOnce({
      response: JSON.stringify({
        scores: [{ id: '1', score: 0.7, relevant: true, reason: 'Good match' }],
      }),
    });

    const records = [{ id: '1', text: 'About cars', title: 'Cars' }];
    const results = await scoreRelevance(records, 'cars', options);

    expect(results.get('1')?.score).toBe(0.7);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('should call progress callback', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        scores: [{ id: '1', score: 0.9, relevant: true, reason: 'Perfect' }],
      }),
    });

    const progressCb = vi.fn();
    const records = [{ id: '1', text: 'About sports cars', title: 'Sports' }];

    await scoreRelevance(records, 'sports', options, progressCb);

    expect(progressCb).toHaveBeenCalled();
    expect(progressCb.mock.calls[0][0]).toMatchObject({
      stage: 'classification',
    });
  });

  it('should not set fallback result on individual record failure', async () => {
    // Batch fails, then individual fails too
    mockGenerate.mockRejectedValue(new Error('API Error'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];

    // With default retries (3), it should fail batch, then try individual, which also fails
    // No fallback result should be set
    const results = await scoreRelevance(records, 'topic', options);
    expect(results.get('1')).toBeUndefined();
  });

  it('should return partial results on abort instead of throwing', async () => {
    let callCount = 0;
    mockGenerate.mockImplementation(() => {
      callCount++;
      if (callCount > 1) {
        setTransformAbortFlag(true);
      }
      return Promise.resolve({
        response: JSON.stringify({
          scores: [
            {
              id: String(callCount),
              score: 0.8,
              relevant: true,
              reason: 'Match',
            },
          ],
        }),
      });
    });

    const records = [
      { id: '1', text: 'Text 1', title: 'Title 1' },
      { id: '2', text: 'Text 2', title: 'Title 2' },
      { id: '3', text: 'Text 3', title: 'Title 3' },
      { id: '4', text: 'Text 4', title: 'Title 4' },
    ];

    // Should NOT throw
    const results = await scoreRelevance(records, 'topic', { ...options, batchSize: 1 });
    expect(results.size).toBeGreaterThanOrEqual(1);
  });

  it('should return empty results on consecutive failures in noFallback mode', async () => {
    mockGenerate.mockRejectedValue(new Error('LLM down'));

    const noFallbackOptions = { ...options, noFallback: true, batchSize: 1, retries: 1 };
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      text: `Text ${i}`,
      title: `Title ${i}`,
    }));

    const results = await scoreRelevance(records, 'topic', noFallbackOptions);
    expect(results.size).toBe(0);
  });
});

describe('generateQA', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should generate Q&A pairs', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        qa_pairs: [{ id: '1', instruction: 'What is this?', output: 'This is a test.' }],
      }),
    });

    const records = [{ id: '1', text: 'This is a test article.', title: 'Test' }];
    const results = await generateQA(records, options);

    expect(results.get('1')?.instruction).toBe('What is this?');
    expect(results.get('1')?.output).toBe('This is a test.');
  });

  it('should fall back to individual processing on batch failure', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('Batch failed')).mockResolvedValueOnce({
      response: JSON.stringify({
        qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
      }),
    });

    const records = [{ id: '1', text: 'Text', title: 'Title' }];
    const results = await generateQA(records, options);

    expect(results.get('1')).toBeDefined();
  });

  it('should not set fallback result on individual record failure', async () => {
    mockGenerate.mockRejectedValue(new Error('All fail'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];
    const results = await generateQA(records, options);

    // No fallback — undefined
    expect(results.get('1')).toBeUndefined();
  });

  it('should call progress callback with correct counts', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        qa_pairs: [
          { id: '1', instruction: 'Q1', output: 'A1' },
          { id: '2', instruction: 'Q2', output: 'A2' },
        ],
      }),
    });

    const progressCb = vi.fn();
    const records = [
      { id: '1', text: 'Text 1', title: 'Title 1' },
      { id: '2', text: 'Text 2', title: 'Title 2' },
    ];

    await generateQA(records, options, progressCb);

    expect(progressCb).toHaveBeenCalled();
    const lastCall = progressCb.mock.calls[progressCb.mock.calls.length - 1][0];
    expect(lastCall.stage).toBe('generation');
    expect(lastCall.completed).toBeGreaterThan(0);
  });

  it('should return empty results on consecutive failures in noFallback mode', async () => {
    mockGenerate.mockRejectedValue(new Error('LLM down'));

    const noFallbackOptions = { ...options, noFallback: true, batchSize: 1, retries: 1 };
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      text: `Text ${i}`,
      title: `Title ${i}`,
    }));

    const results = await generateQA(records, noFallbackOptions);
    expect(results.size).toBe(0);
  });

  it('should respect configurable retries', async () => {
    mockGenerate.mockRejectedValue(new Error('fail'));

    const retryOptions = { ...options, retries: 1, batchSize: 1 };
    const records = [{ id: '1', text: 'Text', title: 'Title' }];

    await generateQA(records, retryOptions);

    // Batch fails (1 retry) -> individual fails (1 retry) = 2 total calls
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});

describe('generateConversation', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-conversation',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should generate conversations', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        conversation: [
          { role: 'user', content: 'Tell me about this' },
          { role: 'assistant', content: 'Here is the information.' },
        ],
      }),
    });

    const records = [{ id: '1', text: 'Article content.', title: 'Article' }];
    const results = await generateConversation(records, options);

    const conversation = results.get('1');
    expect(conversation).toHaveLength(2);
    expect(conversation?.[0].role).toBe('user');
    expect(conversation?.[1].role).toBe('assistant');
  });

  it('should not set fallback on failure', async () => {
    mockGenerate.mockRejectedValue(new Error('Failed'));

    const records = [{ id: '1', text: 'Article content.', title: 'Article' }];
    const results = await generateConversation(records, options);

    // No fallback — undefined
    expect(results.get('1')).toBeUndefined();
  });

  it('should process records sequentially', async () => {
    let callCount = 0;
    mockGenerate.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        response: JSON.stringify({
          conversation: [
            { role: 'user', content: `Q${callCount}` },
            { role: 'assistant', content: `A${callCount}` },
          ],
        }),
      });
    });

    const records = [
      { id: '1', text: 'Text 1', title: 'Title 1' },
      { id: '2', text: 'Text 2', title: 'Title 2' },
    ];

    await generateConversation(records, options);

    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('should return empty results on consecutive failures in noFallback mode', async () => {
    mockGenerate.mockRejectedValue(new Error('LLM down'));

    const noFallbackOptions = { ...options, noFallback: true, retries: 1 };
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      text: `Text ${i}`,
      title: `Title ${i}`,
    }));

    const results = await generateConversation(records, noFallbackOptions);
    expect(results.size).toBe(0);
  });
});

describe('generateInstruction', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-instruct',
    relevanceThreshold: 0.5,
    batchSize: 2,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should generate instruction pairs', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        instructions: [
          {
            id: '1',
            instruction: 'Summarize this',
            input: '',
            output: 'This is the summary.',
          },
        ],
      }),
    });

    const records = [{ id: '1', text: 'Article content.', title: 'Article' }];
    const results = await generateInstruction(records, options);

    const instruction = results.get('1');
    expect(instruction?.instruction).toBe('Summarize this');
    expect(instruction?.output).toBe('This is the summary.');
  });

  it('should include input field when provided', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        instructions: [
          {
            id: '1',
            instruction: 'Answer this',
            input: 'What is 2+2?',
            output: 'The answer is 4.',
          },
        ],
      }),
    });

    const records = [{ id: '1', text: 'Math article.', title: 'Math' }];
    const results = await generateInstruction(records, options);

    expect(results.get('1')?.input).toBe('What is 2+2?');
  });

  it('should handle batch processing', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        instructions: [
          { id: '1', instruction: 'Q1', input: '', output: 'A1' },
          { id: '2', instruction: 'Q2', input: '', output: 'A2' },
        ],
      }),
    });

    const records = [
      { id: '1', text: 'Text 1', title: 'Title 1' },
      { id: '2', text: 'Text 2', title: 'Title 2' },
    ];

    const results = await generateInstruction(records, options);

    expect(results.size).toBe(2);
  });

  it('should not set fallback on individual record failure', async () => {
    mockGenerate.mockRejectedValue(new Error('All fail'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];
    const results = await generateInstruction(records, options);

    // No fallback — undefined
    expect(results.get('1')).toBeUndefined();
  });

  it('should return empty results on consecutive failures in noFallback mode', async () => {
    mockGenerate.mockRejectedValue(new Error('LLM down'));

    const noFallbackOptions = { ...options, noFallback: true, batchSize: 1, retries: 1 };
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      text: `Text ${i}`,
      title: `Title ${i}`,
    }));

    const results = await generateInstruction(records, noFallbackOptions);
    expect(results.size).toBe(0);
  });
});

describe('tryParseJson - malformed LLM output recovery', () => {
  it('should parse valid JSON directly', () => {
    const result = _tryParseJson('{"scores": []}');
    expect(result).toEqual({ scores: [] });
  });

  it('should extract JSON from markdown code blocks', () => {
    const input =
      'Here is the result:\n```json\n{"scores": [{"id": "1", "score": 0.8, "relevant": true, "reason": "match"}]}\n```\nDone.';
    const result = _tryParseJson(input) as { scores: unknown[] };
    expect(result.scores).toHaveLength(1);
  });

  it('should extract JSON from code blocks without json tag', () => {
    const input = '```\n{"qa_pairs": [{"id": "1", "instruction": "Q", "output": "A"}]}\n```';
    const result = _tryParseJson(input) as { qa_pairs: unknown[] };
    expect(result.qa_pairs).toHaveLength(1);
  });

  it('should extract embedded JSON from mixed text', () => {
    const input =
      'Sure! Here is the JSON output:\n{"conversation": [{"role": "user", "content": "Hi"}]}\nI hope this helps!';
    const result = _tryParseJson(input) as { conversation: unknown[] };
    expect(result.conversation).toHaveLength(1);
  });

  it('should return null for empty/whitespace input', () => {
    expect(_tryParseJson('')).toBeNull();
    expect(_tryParseJson('   ')).toBeNull();
  });

  it('should return null for truncated JSON', () => {
    expect(_tryParseJson('{"scores": [{"id": "1", "sco')).toBeNull();
  });

  it('should return null for plain text with no JSON', () => {
    expect(_tryParseJson('I cannot generate that content.')).toBeNull();
  });
});

describe('LLM processor - malformed JSON recovery (integration)', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 1,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should recover from markdown-wrapped JSON in scoreRelevance', async () => {
    mockGenerate.mockResolvedValue({
      response:
        '```json\n{"scores": [{"id": "1", "score": 0.9, "relevant": true, "reason": "match"}]}\n```',
    });

    const records = [{ id: '1', text: 'About cars', title: 'Cars' }];
    const results = await scoreRelevance(records, 'cars', options);
    expect(results.get('1')?.score).toBe(0.9);
  });

  it('should recover from mixed text JSON in generateQA', async () => {
    mockGenerate.mockResolvedValue({
      response:
        'Here are the QA pairs:\n{"qa_pairs": [{"id": "1", "instruction": "What?", "output": "Answer."}]}\nDone!',
    });

    const records = [{ id: '1', text: 'Article text.', title: 'Test' }];
    const results = await generateQA(records, options);
    expect(results.get('1')?.instruction).toBe('What?');
  });

  it('should recover from markdown-wrapped JSON in generateConversation', async () => {
    mockGenerate.mockResolvedValue({
      response:
        '```json\n{"conversation": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"}]}\n```',
    });

    const records = [{ id: '1', text: 'Article.', title: 'Test' }];
    const results = await generateConversation(records, options);
    expect(results.get('1')).toHaveLength(2);
  });

  it('should recover from mixed text JSON in generateInstruction', async () => {
    mockGenerate.mockResolvedValue({
      response:
        'Output:\n{"instructions": [{"id": "1", "instruction": "Do this", "input": "", "output": "Done"}]}',
    });

    const records = [{ id: '1', text: 'Article.', title: 'Test' }];
    const results = await generateInstruction(records, options);
    expect(results.get('1')?.instruction).toBe('Do this');
  });

  it('should fail gracefully on truncated JSON without crashing', async () => {
    mockGenerate.mockResolvedValue({
      response: '{"scores": [{"id": "1", "sco',
    });

    const records = [{ id: '1', text: 'Text', title: 'Title' }];
    // Should not throw unhandled error, just fail and record as failed
    const results = await scoreRelevance(records, 'topic', { ...options, retries: 1 });
    expect(results.get('1')).toBeUndefined();
  });

  it('should fail gracefully on empty LLM response', async () => {
    mockGenerate.mockResolvedValue({ response: '' });

    const records = [{ id: '1', text: 'Text', title: 'Title' }];
    const results = await generateQA(records, { ...options, retries: 1 });
    expect(results.get('1')).toBeUndefined();
  });
});

describe('ModelNotFoundError - no retry in LLM processor', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 1,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should not retry on ModelNotFoundError in scoreRelevance', async () => {
    mockGenerate.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];

    // Batch fails with ModelNotFoundError (1 call), then individual also fails (1 call)
    // Each processRelevanceBatch call should only attempt once (no retries)
    await scoreRelevance(records, 'topic', { ...options, retries: 3 });
    expect(mockGenerate).toHaveBeenCalledTimes(2); // batch + individual, both bail immediately
  });

  it('should not retry on ModelNotFoundError in generateQA', async () => {
    mockGenerate.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];

    await generateQA(records, { ...options, retries: 3 });
    expect(mockGenerate).toHaveBeenCalledTimes(2); // batch + individual
  });

  it('should not retry on ModelNotFoundError in generateConversation', async () => {
    mockGenerate.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];

    await generateConversation(records, { ...options, retries: 3 });
    // processConversation is called once, bails immediately
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('should not retry on ModelNotFoundError in generateInstruction', async () => {
    mockGenerate.mockRejectedValue(new ModelNotFoundError('nonexistent'));

    const records = [{ id: '1', text: 'Text', title: 'Title' }];

    await generateInstruction(records, { ...options, retries: 3 });
    expect(mockGenerate).toHaveBeenCalledTimes(2); // batch + individual
  });
});

describe('verbose logging', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 1,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
    verbose: true,
  };

  // The logger mock is defined at the top of this file via vi.mock
  // We can access it through vi.mocked after importing
  let mockedDebug: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
    process.env.VERBOSE = 'true';
    const { logger: mockLogger } = await import('../utils/logger');
    mockedDebug = vi.mocked(mockLogger.debug);
    mockedDebug.mockClear();
  });

  afterEach(() => {
    delete process.env.VERBOSE;
  });

  it('should log prompt before LLM call in generateQA', async () => {
    mockGenerate.mockResolvedValue({
      response: JSON.stringify({
        qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
      }),
    });

    const records = [{ id: '1', text: 'Article text.', title: 'Test' }];
    await generateQA(records, options);

    const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(debugCalls.some((msg: string) => msg.includes('[LLM prompt]'))).toBe(true);
    expect(debugCalls.some((msg: string) => msg.includes('[LLM raw]'))).toBe(true);
  });

  it('should log attempt counter in retry messages', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce({
      response: JSON.stringify({
        qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
      }),
    });

    const records = [{ id: '1', text: 'Article text.', title: 'Test' }];
    await generateQA(records, options);

    const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(debugCalls.some((msg: string) => msg.includes('[attempt 1/'))).toBe(true);
  });

  it('should log full response on parse failure', async () => {
    const badResponse = 'This is not valid JSON at all';
    mockGenerate.mockResolvedValue({ response: badResponse });

    const records = [{ id: '1', text: 'About cars', title: 'Cars' }];
    await scoreRelevance(records, 'cars', options);

    const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(
      debugCalls.some((msg: string) => msg.includes('[LLM full response on parse failure]'))
    ).toBe(true);
  });
});

describe('parse failure diagnostics', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 1,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
    verbose: false,
  };

  beforeEach(() => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
  });

  it('should include content preview in parse failure error for scoreRelevance', async () => {
    const badResponse = 'This is not valid JSON at all, just some random text from the LLM';
    mockGenerate.mockResolvedValue({ response: badResponse });

    const records = [{ id: '1', text: 'About cars', title: 'Cars' }];
    // scoreRelevance catches errors and returns empty results, so we check via console.warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await scoreRelevance(records, 'cars', options);

    const warnCalls = warnSpy.mock.calls.flat().map(String);
    const hasPreview = warnCalls.some(
      (msg) => msg.includes('chars') && msg.includes('This is not valid JSON')
    );
    expect(hasPreview).toBe(true);

    warnSpy.mockRestore();
  });

  it('should include (empty) preview when LLM returns empty string', async () => {
    mockGenerate.mockResolvedValue({ response: '' });

    const records = [{ id: '1', text: 'About cars', title: 'Cars' }];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await scoreRelevance(records, 'cars', options);

    const warnCalls = warnSpy.mock.calls.flat().map(String);
    const hasEmpty = warnCalls.some((msg) => msg.includes('(empty)') || msg.includes('0 chars'));
    expect(hasEmpty).toBe(true);

    warnSpy.mockRestore();
  });

  it('should include content preview in parse failure error for generateQA', async () => {
    const badResponse = 'Not JSON - model returned plain text instead';
    mockGenerate.mockResolvedValue({ response: badResponse });

    const records = [{ id: '1', text: 'About cars', title: 'Cars' }];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await generateQA(records, options);

    const warnCalls = warnSpy.mock.calls.flat().map(String);
    const hasPreview = warnCalls.some((msg) => msg.includes('chars') && msg.includes('Not JSON'));
    expect(hasPreview).toBe(true);

    warnSpy.mockRestore();
  });
});

describe('Phase 4 — LLM Robustness', () => {
  const options: TransformOptions = {
    input: './test',
    template: 'text-qa',
    relevanceThreshold: 0.5,
    batchSize: 3,
    minTextLength: 50,
    maxTextLength: 10000,
    noLlm: false,
    dedupe: false,
    yes: false,
  };

  let mockedDebug: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockGenerate.mockClear();
    setTransformAbortFlag(false);
    clearPromptCache();
    const { logger: mockLogger } = await import('../utils/logger');
    mockedDebug = vi.mocked(mockLogger.debug);
    mockedDebug.mockClear();
  });

  describe('4.1 — extractFinalResponse not double-called', () => {
    it('should use response.response directly without extractFinalResponse', async () => {
      // The mock for extractFinalResponse returns text as-is (identity function).
      // If extractFinalResponse were still called, the response would still work.
      // The key test: response.response is used directly — no transformation.
      const rawResponse = JSON.stringify({
        qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
      });
      mockGenerate.mockResolvedValue({ response: rawResponse });

      const records = [{ id: '1', text: 'Article text.', title: 'Test' }];
      const results = await generateQA(records, { ...options, batchSize: 1 });

      expect(results.get('1')?.instruction).toBe('Q1');
      // Verify the raw response was logged (no "cleaned" log since we removed that step)
      const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(debugCalls.some((msg: string) => msg.includes('[LLM raw]'))).toBe(true);
      // No "[LLM cleaned]" log should exist since extractFinalResponse is removed
      expect(debugCalls.some((msg: string) => msg.includes('[LLM cleaned]'))).toBe(false);
    });
  });

  describe('4.2 — batch size defaults to 1 for small models', () => {
    it('should use batch size 1 for model "qwen3.5:2b"', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
        }),
      });

      const records = [
        { id: '1', text: 'Text 1', title: 'Title 1' },
        { id: '2', text: 'Text 2', title: 'Title 2' },
        { id: '3', text: 'Text 3', title: 'Title 3' },
      ];

      await generateQA(records, { ...options, model: 'qwen3.5:2b', batchSize: 3 });

      // With batch size 1, each record is sent individually = 3 calls
      expect(mockGenerate).toHaveBeenCalledTimes(3);
    });

    it('should use batch size 1 for model "phi:1b"', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
        }),
      });

      const records = [
        { id: '1', text: 'Text 1', title: 'Title 1' },
        { id: '2', text: 'Text 2', title: 'Title 2' },
      ];

      await generateQA(records, { ...options, model: 'phi:1b', batchSize: 5 });
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('should use batch size 1 for model with 0.5b', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          scores: [{ id: '1', score: 0.9, relevant: true, reason: 'match' }],
        }),
      });

      const records = [
        { id: '1', text: 'Text 1', title: 'Title 1' },
        { id: '2', text: 'Text 2', title: 'Title 2' },
      ];

      await scoreRelevance(records, 'topic', { ...options, model: 'tiny:0.5b', batchSize: 5 });
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('should keep default batch size for larger models like "llama3:8b"', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [
            { id: '1', instruction: 'Q1', output: 'A1' },
            { id: '2', instruction: 'Q2', output: 'A2' },
            { id: '3', instruction: 'Q3', output: 'A3' },
          ],
        }),
      });

      const records = [
        { id: '1', text: 'Text 1', title: 'Title 1' },
        { id: '2', text: 'Text 2', title: 'Title 2' },
        { id: '3', text: 'Text 3', title: 'Title 3' },
      ];

      await generateQA(records, { ...options, model: 'llama3:8b', batchSize: 3 });
      // All 3 in one batch = 1 call
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it('should keep default batch size for "mixtral:47b"', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [
            { id: '1', instruction: 'Q1', output: 'A1' },
            { id: '2', instruction: 'Q2', output: 'A2' },
          ],
        }),
      });

      const records = [
        { id: '1', text: 'Text 1', title: 'Title 1' },
        { id: '2', text: 'Text 2', title: 'Title 2' },
      ];

      await generateQA(records, { ...options, model: 'mixtral:47b', batchSize: 2 });
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe('4.3 — ID validation logs mismatches', () => {
    it('should log ID mismatch when LLM returns wrong IDs without crashing', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [{ id: 'wrong_id', instruction: 'Q1', output: 'A1' }],
        }),
      });

      const records = [{ id: '1', text: 'Text', title: 'Title' }];
      const results = await generateQA(records, { ...options, batchSize: 1 });

      // Should not crash
      expect(results.get('1')).toBeUndefined();
      expect(results.get('wrong_id')).toBeDefined();

      const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(debugCalls.some((msg: string) => msg.includes('[LLM ID mismatch]'))).toBe(true);
    });

    it('should log ID mismatch in scoreRelevance without crashing', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          scores: [{ id: 'bad_id', score: 0.9, relevant: true, reason: 'match' }],
        }),
      });

      const records = [{ id: '1', text: 'Text', title: 'Title' }];
      const results = await scoreRelevance(records, 'topic', { ...options, batchSize: 1 });

      expect(results.get('1')).toBeUndefined();
      expect(results.get('bad_id')).toBeDefined();

      const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(debugCalls.some((msg: string) => msg.includes('[LLM ID mismatch]'))).toBe(true);
    });
  });

  describe('4.4 — structured failure categories in stats', () => {
    it('should include failureBreakdown on generateQA results', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
        }),
      });

      const records = [{ id: '1', text: 'Text', title: 'Title' }];
      const results = (await generateQA(records, { ...options, batchSize: 1 })) as QAResultMap;

      expect(results.failureBreakdown).toBeDefined();
      expect(results.failureBreakdown!.emptyResponse).toBe(0);
      expect(results.failureBreakdown!.jsonParseError).toBe(0);
      expect(results.failureBreakdown!.idMismatch).toBe(0);
    });

    it('should track jsonParseError failures', async () => {
      mockGenerate.mockResolvedValue({ response: 'not json at all' });

      const records = [{ id: '1', text: 'Text', title: 'Title' }];
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const results = (await generateQA(records, {
        ...options,
        batchSize: 1,
        retries: 1,
      })) as QAResultMap;

      expect(results.failureBreakdown).toBeDefined();
      expect(results.failureBreakdown!.jsonParseError).toBeGreaterThan(0);

      warnSpy.mockRestore();
    });

    it('should track emptyResponse failures', async () => {
      mockGenerate.mockResolvedValue({ response: '' });

      const records = [{ id: '1', text: 'Text', title: 'Title' }];
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const results = (await generateQA(records, {
        ...options,
        batchSize: 1,
        retries: 1,
      })) as QAResultMap;

      expect(results.failureBreakdown).toBeDefined();
      expect(results.failureBreakdown!.emptyResponse).toBeGreaterThan(0);

      warnSpy.mockRestore();
    });

    it('should track idMismatch when LLM returns wrong IDs', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [{ id: 'wrong', instruction: 'Q', output: 'A' }],
        }),
      });

      const records = [{ id: '1', text: 'Text', title: 'Title' }];
      const results = (await generateQA(records, { ...options, batchSize: 1 })) as QAResultMap;

      expect(results.failureBreakdown).toBeDefined();
      expect(results.failureBreakdown!.idMismatch).toBe(1);
    });
  });

  describe('4.5 — deduplicate identical input text', () => {
    it('should send fewer LLM requests for identical input texts', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          qa_pairs: [{ id: '1', instruction: 'Q1', output: 'A1' }],
        }),
      });

      // 3 records with identical text
      const records = [
        { id: '1', text: 'Same text content here', title: 'Title 1' },
        { id: '2', text: 'Same text content here', title: 'Title 2' },
        { id: '3', text: 'Same text content here', title: 'Title 3' },
      ];

      const results = await generateQA(records, { ...options, batchSize: 1 });

      // Only 1 unique text, so only 1 LLM call
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      // But result is replicated to all 3 records
      expect(results.get('1')).toBeDefined();
      expect(results.get('2')).toBeDefined();
      expect(results.get('3')).toBeDefined();

      const debugCalls = mockedDebug.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(debugCalls.some((msg: string) => msg.includes('[LLM dedup]'))).toBe(true);
    });

    it('should not dedup records with different text', async () => {
      let callCount = 0;
      mockGenerate.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          response: JSON.stringify({
            qa_pairs: [
              { id: String(callCount), instruction: `Q${callCount}`, output: `A${callCount}` },
            ],
          }),
        });
      });

      const records = [
        { id: '1', text: 'Unique text A', title: 'Title 1' },
        { id: '2', text: 'Unique text B', title: 'Title 2' },
      ];

      const results = await generateQA(records, { ...options, batchSize: 1 });

      // 2 unique texts = 2 LLM calls
      expect(mockGenerate).toHaveBeenCalledTimes(2);
      expect(results.size).toBe(2);
    });

    it('should dedup identical texts in scoreRelevance', async () => {
      mockGenerate.mockResolvedValue({
        response: JSON.stringify({
          scores: [{ id: '1', score: 0.8, relevant: true, reason: 'match' }],
        }),
      });

      const records = [
        { id: '1', text: 'Same text', title: 'Title 1' },
        { id: '2', text: 'Same text', title: 'Title 2' },
        { id: '3', text: 'Same text', title: 'Title 3' },
      ];

      const results = await scoreRelevance(records, 'topic', { ...options, batchSize: 1 });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(results.get('1')).toBeDefined();
      expect(results.get('2')).toBeDefined();
      expect(results.get('3')).toBeDefined();
    });
  });
});
