import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wrapAction } from '../commandWrapper';
import { CLIError } from '../errorCodes';
import { ExitCode } from '../exitCodes';
import { setGlobalFlags } from '../output';
import { ModelNotFoundError } from '../../generators/ollama';
import { LLMAbortError } from '../../transformer/llm-processor';
import { VisionAbortError } from '../../transformer/vision-processor';

// Mock chalk to return plain strings
vi.mock('chalk', () => {
  const passthrough = (s: any) => String(s);
  const chainable: any = new Proxy(passthrough, {
    get: () => chainable,
    apply: (_t: any, _this: any, args: any[]) => String(args[0]),
  });
  return { default: chainable };
});

describe('commandWrapper', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should call the wrapped function normally on success', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = wrapAction('test', fn);
    await wrapped({ input: 'file.json' });
    expect(fn).toHaveBeenCalledWith({ input: 'file.json' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should handle CLIError with correct exit code in normal mode', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new CLIError('INVALID_INPUT', 'Missing --input', ExitCode.INVALID_INPUT));
    const wrapped = wrapAction('test', fn);
    await wrapped({});

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Missing --input'));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_INPUT);
  });

  it('should output JSON error for CLIError in JSON mode', async () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
    const fn = vi.fn().mockRejectedValue(
      new CLIError('FILE_NOT_FOUND', 'file.json not found', ExitCode.INVALID_INPUT, {
        path: 'file.json',
      })
    );
    const wrapped = wrapAction('test', fn);
    await wrapped({});

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(output.error).toBe(true);
    expect(output.code).toBe('FILE_NOT_FOUND');
    expect(output.message).toBe('file.json not found');
    expect(output.details).toEqual({ path: 'file.json' });
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_INPUT);
  });

  it('should handle generic errors with GENERAL_ERROR exit code', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('unexpected failure'));
    const wrapped = wrapAction('test', fn);
    await wrapped({});

    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR);
  });

  it('should output JSON for generic errors in JSON mode', async () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
    const fn = vi.fn().mockRejectedValue(new Error('unexpected failure'));
    const wrapped = wrapAction('test', fn);
    await wrapped({});

    const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(output.error).toBe(true);
    expect(output.code).toBe('GENERAL_ERROR');
    expect(output.message).toBe('unexpected failure');
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR);
  });

  it('should handle non-Error thrown values', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const wrapped = wrapAction('test', fn);
    await wrapped({});

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR);
  });

  it('should pass through all arguments to the wrapped function', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = wrapAction('test', fn);
    await wrapped({ flag: true }, 'arg1', 'arg2');
    expect(fn).toHaveBeenCalledWith({ flag: true }, 'arg1', 'arg2');
  });

  describe('error classification', () => {
    it('should classify ModelNotFoundError as OLLAMA_UNAVAILABLE (exit code 5)', async () => {
      const fn = vi.fn().mockRejectedValue(new ModelNotFoundError('llama3'));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.OLLAMA_UNAVAILABLE);
    });

    it('should classify LLMAbortError as USER_ABORT (exit code 7)', async () => {
      const fn = vi.fn().mockRejectedValue(new LLMAbortError('Too many failures', new Map()));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.USER_ABORT);
    });

    it('should classify VisionAbortError as USER_ABORT (exit code 7)', async () => {
      const fn = vi.fn().mockRejectedValue(new VisionAbortError('Vision failures', new Map()));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.USER_ABORT);
    });

    it('should classify ECONNREFUSED errors as NETWORK_ERROR (exit code 4)', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.NETWORK_ERROR);
    });

    it('should classify ETIMEDOUT errors as NETWORK_ERROR (exit code 4)', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT 10.0.0.1:443'));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.NETWORK_ERROR);
    });

    it('should classify SyntaxError as INVALID_INPUT (exit code 2)', async () => {
      const fn = vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_INPUT);
    });

    it('should classify plain Error as GENERAL_ERROR (exit code 1)', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('something went wrong'));
      const wrapped = wrapAction('test', fn);
      await wrapped({});
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR);
    });
  });
});
