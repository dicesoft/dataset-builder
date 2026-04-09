/**
 * Stdin reader utility for agent-friendly CLI
 * Reads JSON input from stdin when piped (non-TTY)
 */

/**
 * Read all data from stdin if it's being piped (non-TTY).
 * Returns null if stdin is a TTY (interactive terminal) or if no data arrives within timeout.
 */
export async function readStdin(): Promise<string | null> {
  // Don't read if stdin is a TTY (user didn't pipe anything)
  if (process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim() || null));
    // Timeout: if no data arrives in 100ms, assume no stdin
    setTimeout(() => {
      if (!data) {
        process.stdin.destroy();
        resolve(null);
      }
    }, 100);
  });
}
