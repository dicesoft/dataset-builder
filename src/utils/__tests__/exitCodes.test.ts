import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitCode, exitWithCode } from '../exitCodes';
import { setGlobalFlags } from '../output';

describe('exitCodes', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });

  describe('ExitCode enum', () => {
    it('should have all proposed values', () => {
      expect(ExitCode.SUCCESS).toBe(0);
      expect(ExitCode.GENERAL_ERROR).toBe(1);
      expect(ExitCode.INVALID_INPUT).toBe(2);
      expect(ExitCode.MISSING_DEPENDENCY).toBe(3);
      expect(ExitCode.NETWORK_ERROR).toBe(4);
      expect(ExitCode.OLLAMA_UNAVAILABLE).toBe(5);
      expect(ExitCode.PARTIAL_SUCCESS).toBe(6);
      expect(ExitCode.USER_ABORT).toBe(7);
    });

    it('should have exactly 8 values (0-7)', () => {
      const numericValues = Object.values(ExitCode).filter((v) => typeof v === 'number');
      expect(numericValues).toHaveLength(8);
    });
  });

  describe('exitWithCode', () => {
    it('should call process.exit with the correct code', () => {
      exitWithCode(ExitCode.INVALID_INPUT);
      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it('should call process.exit with SUCCESS (0)', () => {
      exitWithCode(ExitCode.SUCCESS);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should output error JSON in JSON mode when message is provided', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      exitWithCode(ExitCode.INVALID_INPUT, 'Missing required input');

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.error).toBe(true);
      expect(output.code).toBe('INVALID_INPUT');
      expect(output.message).toBe('Missing required input');
      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it('should not output JSON when not in JSON mode', () => {
      exitWithCode(ExitCode.GENERAL_ERROR, 'Something failed');
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should not output JSON when no message is provided', () => {
      setGlobalFlags({ json: true, quiet: false, yes: false, verbose: false, dryRun: false });
      exitWithCode(ExitCode.USER_ABORT);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(7);
    });
  });
});
