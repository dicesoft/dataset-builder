/**
 * Sensitive field masking utilities
 * Redacts values of known API key fields to prevent credential leaks in logs
 */

const DEFAULT_SENSITIVE_KEYS = [
  'googleApiKey',
  'bingApiKey',
  'braveApiKey',
  'ollamaApiKey',
  'githubToken',
  'semanticScholarApiKey',
  'serpApiKey',
];

/**
 * Redacts values of known sensitive fields to `first3...last3` format.
 * Non-sensitive fields are passed through unchanged.
 */
export function maskSensitiveFields(
  obj: Record<string, unknown>,
  sensitiveKeys: string[] = DEFAULT_SENSITIVE_KEYS
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const sensitiveSet = new Set(sensitiveKeys);

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveSet.has(key) && typeof value === 'string' && value.length > 0) {
      result[key] = maskValue(value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskSensitiveFields(value as Record<string, unknown>, sensitiveKeys);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function maskValue(value: string): string {
  if (value.length <= 6) {
    return '***';
  }
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}
