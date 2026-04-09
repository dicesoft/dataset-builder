/**
 * Path utilities for the dashboard.
 * Converts absolute paths to relative display paths so filesystem
 * structure is never leaked to the browser.
 */

/**
 * Convert an absolute path to a path relative to `rootDir`.
 *
 * - If `absPath` is already relative (no leading `/` or drive letter), return as-is.
 * - If `absPath` starts with `rootDir`, strip the prefix and leading separators.
 * - Normalises backslashes to forward slashes for consistent display.
 * - Returns the original path unchanged when it cannot be relativized
 *   (e.g. on a different drive / unrelated root).
 */
export function relativizePath(
  absPath: string | null | undefined,
  rootDir: string | null | undefined
): string {
  if (!absPath) return '';
  if (!rootDir) return normalizeSeparators(absPath);

  const normalizedPath = normalizeSeparators(absPath);
  const normalizedRoot = normalizeSeparators(rootDir);

  // Already relative — no drive letter and no leading slash
  if (!isAbsolute(normalizedPath)) {
    return normalizedPath;
  }

  // Strip trailing slash from root for consistent comparison
  const root = normalizedRoot.replace(/\/+$/, '');

  // Check if the path starts with the root
  if (normalizedPath.toLowerCase().startsWith(root.toLowerCase())) {
    const rest = normalizedPath.slice(root.length);
    // Must be followed by a separator or be exactly the root
    if (rest === '') return '.';
    if (rest.startsWith('/')) return rest.slice(1);
  }

  // Cannot relativize — return normalized but unchanged
  return normalizedPath;
}

/** Normalise Windows backslashes to forward slashes. */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Check whether a normalised path looks absolute (Unix or Windows). */
function isAbsolute(p: string): boolean {
  // Unix absolute
  if (p.startsWith('/')) return true;
  // Windows drive letter, e.g. C:/ or D:/
  if (/^[a-zA-Z]:\//.test(p)) return true;
  return false;
}
