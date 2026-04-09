/**
 * Logger utility for verbose and standard logging
 */

import chalk from 'chalk';
import { isJsonMode, isQuietMode } from './output';
import { maskSensitiveFields } from './sanitize';

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return process.env.VERBOSE === 'true';
}

/**
 * Logger with verbose support
 * In JSON mode: redirects info, success, warn, verbose to stderr (stdout reserved for JSON envelope)
 * In quiet mode: suppresses info, success, verbose entirely
 */
export const logger = {
  /**
   * Debug message - only shown in verbose mode
   */
  debug: (msg: string): void => {
    if (!isVerbose()) return;
    if (isQuietMode()) return;
    const maskedMsg = maskLogMessage(msg);
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify(
          maskSensitiveFields({
            type: 'log',
            level: 'debug',
            message: maskedMsg,
            timestamp: new Date().toISOString(),
          })
        ) + '\n'
      );
    } else {
      console.log(chalk.gray(`[debug] ${maskedMsg}`));
    }
  },

  /**
   * Info message - suppressed in quiet mode, redirected to stderr in JSON mode
   */
  info: (msg: string): void => {
    if (isQuietMode()) return;
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify({
          type: 'log',
          level: 'info',
          message: msg,
          timestamp: new Date().toISOString(),
        }) + '\n'
      );
    } else {
      console.log(chalk.blue(msg));
    }
  },

  /**
   * Success message - suppressed in quiet mode, redirected to stderr in JSON mode
   */
  success: (msg: string): void => {
    if (isQuietMode()) return;
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify({
          type: 'log',
          level: 'success',
          message: msg,
          timestamp: new Date().toISOString(),
        }) + '\n'
      );
    } else {
      console.log(chalk.green(msg));
    }
  },

  /**
   * Warning message - always shown, redirected to stderr in JSON mode
   */
  warn: (msg: string): void => {
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify({
          type: 'log',
          level: 'warn',
          message: msg,
          timestamp: new Date().toISOString(),
        }) + '\n'
      );
    } else {
      console.log(chalk.yellow(msg));
    }
  },

  /**
   * Error message - always goes to stderr
   */
  error: (msg: string): void => {
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify({
          type: 'log',
          level: 'error',
          message: msg,
          timestamp: new Date().toISOString(),
        }) + '\n'
      );
    } else {
      console.error(chalk.red(msg));
    }
  },

  /**
   * Verbose-only info - suppressed in quiet mode, redirected to stderr in JSON mode
   */
  verbose: (msg: string): void => {
    if (!isVerbose()) return;
    if (isQuietMode()) return;
    const maskedMsg = maskLogMessage(msg);
    if (isJsonMode()) {
      process.stderr.write(
        JSON.stringify(
          maskSensitiveFields({
            type: 'log',
            level: 'verbose',
            message: maskedMsg,
            timestamp: new Date().toISOString(),
          })
        ) + '\n'
      );
    } else {
      console.log(chalk.gray(`[verbose] ${maskedMsg}`));
    }
  },
};

/**
 * Mask sensitive key-value patterns in log messages.
 * Detects patterns like key=value or key: value and redacts known sensitive field values.
 */
function maskLogMessage(msg: string): string {
  const sensitivePatterns = [
    'apiKey',
    'api_key',
    'token',
    'secret',
    'password',
    'credential',
    'googleApiKey',
    'bingApiKey',
    'braveApiKey',
    'ollamaApiKey',
    'githubToken',
    'semanticScholarApiKey',
    'serpApiKey',
  ];
  let masked = msg;
  for (const pattern of sensitivePatterns) {
    // Match key=value and key: value patterns (case-insensitive key match)
    const regex = new RegExp(`(${pattern})(\\s*[=:]\\s*)([^\\s,;}{\\]]+)`, 'gi');
    masked = masked.replace(regex, (_match, key: string, separator: string, value: string) => {
      if (value.length <= 6) return `${key}${separator}***`;
      return `${key}${separator}${value.slice(0, 3)}...${value.slice(-3)}`;
    });
  }
  return masked;
}

/**
 * Simple verbose log function
 */
export function verboseLog(msg: string): void {
  if (!isVerbose()) return;
  if (isQuietMode()) return;
  const maskedMsg = maskLogMessage(msg);
  if (isJsonMode()) {
    process.stderr.write(
      JSON.stringify(
        maskSensitiveFields({
          type: 'log',
          level: 'verbose',
          message: maskedMsg,
          timestamp: new Date().toISOString(),
        })
      ) + '\n'
    );
  } else {
    console.log(chalk.gray(`[verbose] ${maskedMsg}`));
  }
}
