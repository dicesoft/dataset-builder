/**
 * Command action wrapper for structured error handling
 * Wraps command actions with CLIError handling and JSON output
 */

import chalk from 'chalk';
import { CLIError } from './errorCodes';
import { outputError, isJsonMode } from './output';
import { ExitCode } from './exitCodes';
import { ModelNotFoundError } from '../generators/ollama';
import { LLMAbortError } from '../transformer/llm-processor';
import { VisionAbortError } from '../transformer/vision-processor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandAction = (...args: any[]) => Promise<void>;

interface ErrorClassification {
  exitCode: ExitCode;
  errorCode: string;
}

type ErrorMatcher = (error: unknown) => boolean;

interface ErrorClassifierEntry {
  match: ErrorMatcher;
  classification: ErrorClassification;
}

/**
 * Registry of error classifiers, checked in order.
 * Add new entries to extend error classification without modifying existing logic.
 */
const errorClassifiers: ErrorClassifierEntry[] = [
  {
    match: (e) => e instanceof ModelNotFoundError,
    classification: { exitCode: ExitCode.OLLAMA_UNAVAILABLE, errorCode: 'OLLAMA_UNAVAILABLE' },
  },
  {
    match: (e) => e instanceof LLMAbortError || e instanceof VisionAbortError,
    classification: { exitCode: ExitCode.USER_ABORT, errorCode: 'USER_ABORT' },
  },
  {
    match: (e) => e instanceof SyntaxError,
    classification: { exitCode: ExitCode.INVALID_INPUT, errorCode: 'INVALID_INPUT' },
  },
  {
    match: (e) =>
      e instanceof Error && (e.message.includes('ECONNREFUSED') || e.message.includes('ETIMEDOUT')),
    classification: { exitCode: ExitCode.NETWORK_ERROR, errorCode: 'NETWORK_ERROR' },
  },
];

/**
 * Register a new error classifier. Entries added later are checked after existing ones.
 */
export function registerErrorClassifier(entry: ErrorClassifierEntry): void {
  errorClassifiers.push(entry);
}

const DEFAULT_CLASSIFICATION: ErrorClassification = {
  exitCode: ExitCode.GENERAL_ERROR,
  errorCode: 'GENERAL_ERROR',
};

/**
 * Classify an unhandled error into a specific exit code using the registry.
 */
function classifyError(error: unknown): ErrorClassification {
  for (const { match, classification } of errorClassifiers) {
    if (match(error)) {
      return classification;
    }
  }
  return DEFAULT_CLASSIFICATION;
}

/**
 * Wrap a command action with structured error handling and JSON output.
 * Usage: command.action(wrapAction('scrape', originalAction))
 */
export function wrapAction(commandName: string, fn: CommandAction): CommandAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof CLIError) {
        if (isJsonMode()) {
          outputError(error.code, error.message, error.details);
        } else {
          console.error(chalk.red(`Error: ${error.message}`));
        }
        process.exit(error.exitCode);
        return;
      }

      const { exitCode, errorCode } = classifyError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (isJsonMode()) {
        outputError(errorCode, message);
      } else {
        console.error(chalk.red('Error:'), message);
      }
      process.exit(exitCode);
    }
  };
}
