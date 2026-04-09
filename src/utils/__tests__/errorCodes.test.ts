import { describe, it, expect } from 'vitest';
import { ErrorCodes, CLIError } from '../errorCodes';
import { ExitCode } from '../exitCodes';

describe('errorCodes', () => {
  describe('ErrorCodes', () => {
    it('should have all defined error codes', () => {
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

    it('should have exactly 10 error codes', () => {
      expect(Object.keys(ErrorCodes)).toHaveLength(10);
    });
  });

  describe('CLIError', () => {
    it('should be an instance of Error', () => {
      const err = new CLIError('INVALID_INPUT', 'bad input');
      expect(err).toBeInstanceOf(Error);
    });

    it('should set name to CLIError', () => {
      const err = new CLIError('GENERAL_ERROR', 'fail');
      expect(err.name).toBe('CLIError');
    });

    it('should propagate code and message', () => {
      const err = new CLIError('NETWORK_ERROR', 'connection refused');
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.message).toBe('connection refused');
    });

    it('should default exitCode to GENERAL_ERROR', () => {
      const err = new CLIError('TRANSFORM_ERROR', 'template failed');
      expect(err.exitCode).toBe(ExitCode.GENERAL_ERROR);
    });

    it('should accept a custom exitCode', () => {
      const err = new CLIError('INVALID_INPUT', 'bad flag', ExitCode.INVALID_INPUT);
      expect(err.exitCode).toBe(ExitCode.INVALID_INPUT);
    });

    it('should accept optional details', () => {
      const details = { field: 'input', expected: 'string' };
      const err = new CLIError('INVALID_INPUT', 'bad input', ExitCode.INVALID_INPUT, details);
      expect(err.details).toEqual(details);
    });

    it('should leave details undefined when not provided', () => {
      const err = new CLIError('GENERAL_ERROR', 'fail');
      expect(err.details).toBeUndefined();
    });
  });
});
