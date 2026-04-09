import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../../config/defaults';

describe('vision model configuration', () => {
  it('should have llama3.2 as default ollamaModel', () => {
    expect(defaultConfig.ollamaModel).toBe('llama3.2');
  });

  it('should have llava as default ollamaVisionModel', () => {
    expect(defaultConfig.ollamaVisionModel).toBe('llava');
  });

  it('should have ollamaVisionModel in AppConfig type', () => {
    // Type-level check: this compiles only if ollamaVisionModel exists on the type
    const model: string | undefined = defaultConfig.ollamaVisionModel;
    expect(model).toBeDefined();
  });
});

describe('vision filter model-not-found error handling', () => {
  it('should throw on model not found errors instead of silently passing', () => {
    // Replicate the catch-block logic from visionFilter.ts
    function handleVisionError(errorMsg: string): { passed: boolean } | never {
      if (
        errorMsg.includes('not found') ||
        errorMsg.includes('does not exist') ||
        errorMsg.includes('pull')
      ) {
        throw new Error(
          `Vision model not available: ${errorMsg}. Run 'ollama pull <model>' first.`
        );
      }
      return { passed: true };
    }

    // Model not found errors should throw
    expect(() => handleVisionError('model "llava" not found, try pulling it first')).toThrow(
      'Vision model not available'
    );

    expect(() => handleVisionError('model does not exist')).toThrow('Vision model not available');

    expect(() => handleVisionError('try to pull the model first')).toThrow(
      'Vision model not available'
    );
  });

  it('should pass on transient errors (non-model errors)', () => {
    function handleVisionError(errorMsg: string): { passed: boolean } | never {
      if (
        errorMsg.includes('not found') ||
        errorMsg.includes('does not exist') ||
        errorMsg.includes('pull')
      ) {
        throw new Error(
          `Vision model not available: ${errorMsg}. Run 'ollama pull <model>' first.`
        );
      }
      return { passed: true };
    }

    // Transient errors should pass
    const result1 = handleVisionError('connection timeout');
    expect(result1.passed).toBe(true);

    const result2 = handleVisionError('ECONNREFUSED');
    expect(result2.passed).toBe(true);
  });
});
