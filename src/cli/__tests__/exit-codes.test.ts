import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import { CLIError, ErrorCodes } from '../../utils/errorCodes';
import { setGlobalFlags, isJsonMode } from '../../utils/output';

describe('ExitCode enum', () => {
  it('has all proposed values with correct numeric codes', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.INVALID_INPUT).toBe(2);
    expect(ExitCode.MISSING_DEPENDENCY).toBe(3);
    expect(ExitCode.NETWORK_ERROR).toBe(4);
    expect(ExitCode.OLLAMA_UNAVAILABLE).toBe(5);
    expect(ExitCode.PARTIAL_SUCCESS).toBe(6);
    expect(ExitCode.USER_ABORT).toBe(7);
  });

  it('has exactly 8 values (0 through 7)', () => {
    // Enum has both forward and reverse mappings, so filter numeric keys
    const numericValues = Object.values(ExitCode).filter((v) => typeof v === 'number');
    expect(numericValues).toHaveLength(8);
  });

  it('reverse-maps numeric codes to names', () => {
    expect(ExitCode[0]).toBe('SUCCESS');
    expect(ExitCode[1]).toBe('GENERAL_ERROR');
    expect(ExitCode[2]).toBe('INVALID_INPUT');
    expect(ExitCode[3]).toBe('MISSING_DEPENDENCY');
    expect(ExitCode[4]).toBe('NETWORK_ERROR');
    expect(ExitCode[5]).toBe('OLLAMA_UNAVAILABLE');
    expect(ExitCode[6]).toBe('PARTIAL_SUCCESS');
    expect(ExitCode[7]).toBe('USER_ABORT');
  });
});

describe('exitWithCode', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    delete process.env.JSON_OUTPUT;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    delete process.env.JSON_OUTPUT;
  });

  it('calls process.exit with the correct exit code', () => {
    exitWithCode(ExitCode.INVALID_INPUT);
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('calls process.exit with GENERAL_ERROR code', () => {
    exitWithCode(ExitCode.GENERAL_ERROR, 'something went wrong');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('outputs structured JSON in JSON mode', () => {
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    exitWithCode(ExitCode.INVALID_INPUT, 'Missing required field');

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('INVALID_INPUT');
    expect(parsed.message).toBe('Missing required field');

    writeSpy.mockRestore();
  });

  it('does not output JSON when not in JSON mode', () => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    exitWithCode(ExitCode.NETWORK_ERROR, 'Connection failed');

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

describe('CLIError', () => {
  it('creates error with code, message, and exitCode', () => {
    const error = new CLIError('INVALID_INPUT', 'Bad input', ExitCode.INVALID_INPUT);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CLIError);
    expect(error.name).toBe('CLIError');
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toBe('Bad input');
    expect(error.exitCode).toBe(ExitCode.INVALID_INPUT);
    expect(error.details).toBeUndefined();
  });

  it('defaults exitCode to GENERAL_ERROR', () => {
    const error = new CLIError('GENERAL_ERROR', 'Something failed');
    expect(error.exitCode).toBe(ExitCode.GENERAL_ERROR);
  });

  it('includes optional details', () => {
    const details = { field: 'input', expected: 'string', got: 'number' };
    const error = new CLIError('INVALID_INPUT', 'Bad type', ExitCode.INVALID_INPUT, details);

    expect(error.details).toEqual(details);
  });

  it('propagates error code correctly for all error types', () => {
    const errorTypes = [
      { code: ErrorCodes.INVALID_INPUT, exit: ExitCode.INVALID_INPUT },
      { code: ErrorCodes.MISSING_DEPENDENCY, exit: ExitCode.MISSING_DEPENDENCY },
      { code: ErrorCodes.NETWORK_ERROR, exit: ExitCode.NETWORK_ERROR },
      { code: ErrorCodes.OLLAMA_UNAVAILABLE, exit: ExitCode.OLLAMA_UNAVAILABLE },
      { code: ErrorCodes.GENERAL_ERROR, exit: ExitCode.GENERAL_ERROR },
    ];

    for (const { code, exit } of errorTypes) {
      const error = new CLIError(code, `Test ${code}`, exit);
      expect(error.code).toBe(code);
      expect(error.exitCode).toBe(exit);
    }
  });
});

describe('ErrorCodes', () => {
  it('has all expected error code strings', () => {
    expect(ErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(ErrorCodes.MISSING_DEPENDENCY).toBe('MISSING_DEPENDENCY');
    expect(ErrorCodes.NETWORK_ERROR).toBe('NETWORK_ERROR');
    expect(ErrorCodes.OLLAMA_UNAVAILABLE).toBe('OLLAMA_UNAVAILABLE');
    expect(ErrorCodes.TRANSFORM_ERROR).toBe('TRANSFORM_ERROR');
    expect(ErrorCodes.FORMAT_ERROR).toBe('FORMAT_ERROR');
    expect(ErrorCodes.PIPELINE_ERROR).toBe('PIPELINE_ERROR');
    expect(ErrorCodes.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
    expect(ErrorCodes.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
    expect(ErrorCodes.GENERAL_ERROR).toBe('GENERAL_ERROR');
  });
});

describe('ExitCode uniqueness (5.3)', () => {
  it('every ExitCode enum value is unique', () => {
    const numericValues = Object.values(ExitCode).filter((v) => typeof v === 'number') as number[];
    const uniqueValues = new Set(numericValues);
    expect(uniqueValues.size).toBe(numericValues.length);
  });

  it('every ExitCode name is unique', () => {
    const stringNames = Object.values(ExitCode).filter((v) => typeof v === 'string') as string[];
    const uniqueNames = new Set(stringNames);
    expect(uniqueNames.size).toBe(stringNames.length);
  });

  it('ExitCode values are in range 0-7', () => {
    const numericValues = Object.values(ExitCode).filter((v) => typeof v === 'number') as number[];
    for (const val of numericValues) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(7);
    }
  });
});

describe('wrapAction error classification coverage (5.3)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    writeSpy.mockRestore();
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  it('classifies SyntaxError as INVALID_INPUT with exit code 2', async () => {
    const { wrapAction } = await import('../../utils/commandWrapper');
    const action = wrapAction('test', async () => {
      throw new SyntaxError('Unexpected token');
    });
    await action({});

    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.code).toBe('INVALID_INPUT');
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_INPUT);
  });

  it('classifies ECONNREFUSED as NETWORK_ERROR with exit code 4', async () => {
    const { wrapAction } = await import('../../utils/commandWrapper');
    const action = wrapAction('test', async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    });
    await action({});

    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.code).toBe('NETWORK_ERROR');
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.NETWORK_ERROR);
  });

  it('classifies ETIMEDOUT as NETWORK_ERROR with exit code 4', async () => {
    const { wrapAction } = await import('../../utils/commandWrapper');
    const action = wrapAction('test', async () => {
      throw new Error('request ETIMEDOUT');
    });
    await action({});

    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.code).toBe('NETWORK_ERROR');
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.NETWORK_ERROR);
  });

  it('classifies unknown errors as GENERAL_ERROR with exit code 1', async () => {
    const { wrapAction } = await import('../../utils/commandWrapper');
    const action = wrapAction('test', async () => {
      throw new TypeError('Cannot read property');
    });
    await action({});

    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.code).toBe('GENERAL_ERROR');
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR);
  });
});

describe('wrapAction structured error handling', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    writeSpy.mockRestore();
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  it('catches CLIError and outputs structured JSON', async () => {
    const { wrapAction } = await import('../../utils/commandWrapper');

    const action = wrapAction('test', async () => {
      throw new CLIError('INVALID_INPUT', 'Missing field', ExitCode.INVALID_INPUT);
    });

    await action({});

    // Check that structured error was output
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('INVALID_INPUT');
    expect(parsed.message).toBe('Missing field');

    // Check exit code
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_INPUT);
  });

  it('catches generic errors and outputs GENERAL_ERROR', async () => {
    const { wrapAction } = await import('../../utils/commandWrapper');

    const action = wrapAction('test', async () => {
      throw new Error('Unexpected failure');
    });

    await action({});

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe('GENERAL_ERROR');
    expect(parsed.message).toBe('Unexpected failure');
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR);
  });
});
