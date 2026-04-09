/**
 * Writes `dist/server/build-info.json` containing { gitSha, builtAt }.
 *
 * Runs after `tsc` during the build pipeline so the compiled server can
 * read a sibling `./build-info.json` file at boot. Never fails the build:
 * falls back to `process.env.GIT_SHA` and finally the literal string
 * "unknown" on error.
 *
 * Plain ESM JS (not TS) so `npm run build` has no extra runtime dependency —
 * Node can execute it directly with no compile step.
 *
 * Consumed by:
 *   - src/server/index.ts (startup banner)
 *   - Phase 4.6 bundle freshness check
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function resolveGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return (process.env.GIT_SHA && process.env.GIT_SHA.trim()) || 'unknown';
  }
}

function main() {
  const outDir = path.resolve(process.cwd(), 'dist', 'server');
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {
    // Best-effort; if the server bundle wasn't built, the server banner
    // simply falls back to "unknown" at boot.
    return;
  }

  const payload = {
    gitSha: resolveGitSha(),
    builtAt: new Date().toISOString(),
  };

  const outPath = path.join(outDir, 'build-info.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[build-info] wrote ${outPath} (${payload.gitSha} @ ${payload.builtAt})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[build-info] failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

main();
