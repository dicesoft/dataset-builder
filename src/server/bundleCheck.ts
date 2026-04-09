/**
 * Phase 4.6 — Dashboard bundle freshness check.
 *
 * Warns on server boot if the `packages/dashboard/dist/` bundle is
 * significantly older than the server bundle (`dist/server/index.js`).
 * This is a defensive aid to catch the stale-bundle foot-gun that already
 * bit us once during the Bug A/B verification on the pre-fix dev server
 * (see master-plan.md §"Important verification caveat").
 *
 * Behavior (plan §4.6):
 *   - Read the mtime of `packages/dashboard/dist/index.html` and the
 *     newest `*.js` file under `packages/dashboard/dist/assets/`.
 *   - Read the mtime of `dist/server/index.js`.
 *   - If `dashboardMtime < serverMtime - 60_000`, `console.warn` a hint
 *     that includes BOTH mtimes, the server's gitSha (from
 *     `dist/server/build-info.json`), and a pointer to `npm run build:web`.
 *   - If any file is missing (dev mode / Vite serving directly),
 *     silently return.
 *   - NEVER throw. NEVER fail boot.
 */

import fs from 'fs';
import path from 'path';

/** Grace window — server bundles can be slightly newer than the dashboard
 * in normal build order. Only warn on a > 60s gap. */
const STALE_THRESHOLD_MS = 60_000;

/** Best-effort lookup of `dist/server/build-info.json`'s gitSha, returning
 * "unknown" on any failure. Mirrors `server/index.ts#readBuildInfo`. */
function readServerGitSha(): string {
  try {
    const infoPath = path.resolve(__dirname, 'build-info.json');
    const raw = fs.readFileSync(infoPath, 'utf8');
    const parsed = JSON.parse(raw) as { gitSha?: unknown };
    if (typeof parsed.gitSha === 'string' && parsed.gitSha.length > 0) {
      return parsed.gitSha;
    }
  } catch {
    // Missing or malformed — fall through to "unknown".
  }
  return 'unknown';
}

/** Find the newest mtime among `*.js` files directly in an assets dir.
 * Returns null if the directory is missing, unreadable, or has no `.js`
 * files. */
function newestJsAssetMtimeMs(assetsDir: string): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(assetsDir);
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const name of entries) {
    if (!name.endsWith('.js')) continue;
    try {
      const stat = fs.statSync(path.join(assetsDir, name));
      if (newest === null || stat.mtimeMs > newest) {
        newest = stat.mtimeMs;
      }
    } catch {
      // Ignore individual file stat errors.
    }
  }
  return newest;
}

/** Safely stat a single file, returning its mtimeMs or null. */
function safeMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

export interface BundleCheckPaths {
  /** Path to `packages/dashboard/dist/index.html` */
  dashboardIndexHtml: string;
  /** Path to `packages/dashboard/dist/assets` */
  dashboardAssetsDir: string;
  /** Path to `dist/server/index.js` */
  serverBundle: string;
}

/**
 * Default paths, resolved relative to the compiled server location
 * (`dist/server/bundleCheck.js` at runtime). Broken out for unit-test
 * override.
 */
export function defaultBundleCheckPaths(): BundleCheckPaths {
  // At runtime this file lives at `<projectRoot>/dist/server/bundleCheck.js`.
  // `__dirname` === `<projectRoot>/dist/server`. Go up two levels to
  // `<projectRoot>`, then into `packages/dashboard/dist`.
  const projectRoot = path.resolve(__dirname, '..', '..');
  const dashboardDist = path.join(projectRoot, 'packages', 'dashboard', 'dist');
  return {
    dashboardIndexHtml: path.join(dashboardDist, 'index.html'),
    dashboardAssetsDir: path.join(dashboardDist, 'assets'),
    serverBundle: path.join(projectRoot, 'dist', 'server', 'index.js'),
  };
}

/**
 * Run the freshness check. See module docstring for behavior. Never throws.
 *
 * @param paths  Override the file paths used for the check. Primarily for
 *               tests; production callers should omit this arg.
 * @param warn   Optional logger override (tests inject a spy). Defaults to
 *               `console.warn`.
 */
export function checkBundleFreshness(
  paths: BundleCheckPaths = defaultBundleCheckPaths(),
  warn: (message: string) => void = console.warn
): void {
  try {
    const indexMtime = safeMtimeMs(paths.dashboardIndexHtml);
    const assetsMtime = newestJsAssetMtimeMs(paths.dashboardAssetsDir);
    const serverMtime = safeMtimeMs(paths.serverBundle);

    // Any missing piece → silent (dev mode, Vite-served, tarball install).
    if (indexMtime === null || assetsMtime === null || serverMtime === null) {
      return;
    }

    const dashboardMtime = Math.max(indexMtime, assetsMtime);
    if (dashboardMtime < serverMtime - STALE_THRESHOLD_MS) {
      const gitSha = readServerGitSha();
      warn(
        `[bundleCheck] dashboard bundle appears stale relative to server bundle. ` +
          `dashboard mtime=${new Date(dashboardMtime).toISOString()}, ` +
          `server mtime=${new Date(serverMtime).toISOString()}, ` +
          `server gitSha=${gitSha}. ` +
          `Run \`npm run build:web\` to rebuild the dashboard.`
      );
    }
  } catch {
    // Contract: never throw, never fail boot.
  }
}
