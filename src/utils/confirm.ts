/**
 * Unified confirmation prompt utility
 * Replaces 7 separate readline confirmation blocks across the codebase
 */

import { isYesMode } from './output';

/**
 * Prompt the user for yes/no confirmation.
 * Auto-accepts if --yes flag, YES env var, or CI env var is set.
 */
export async function confirm(message: string, defaultYes = true): Promise<boolean> {
  if (isYesMode()) return true;

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';

  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} ${suffix}: `, resolve);
  });
  rl.close();

  const trimmed = answer.trim().toLowerCase();
  if (defaultYes) return trimmed === '' || trimmed === 'y' || trimmed === 'yes';
  return trimmed === 'y' || trimmed === 'yes';
}
