import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkBundleFreshness, type BundleCheckPaths } from './bundleCheck';

/**
 * Phase 4.6 — Unit tests for checkBundleFreshness.
 *
 * Cases (plan §4.6):
 *   - stale dashboard bundle (> 60s older than server) → warn fires
 *   - fresh dashboard bundle (same age / newer)        → no warn
 *   - missing dashboard files                          → silent
 *   - missing server bundle                            → silent
 *   - never throws, even on garbage inputs
 */

function makeTmpLayout(): { root: string; paths: BundleCheckPaths } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundlecheck-'));
  const dashboardDist = path.join(root, 'packages', 'dashboard', 'dist');
  const assetsDir = path.join(dashboardDist, 'assets');
  const serverDir = path.join(root, 'dist', 'server');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });

  return {
    root,
    paths: {
      dashboardIndexHtml: path.join(dashboardDist, 'index.html'),
      dashboardAssetsDir: assetsDir,
      serverBundle: path.join(serverDir, 'index.js'),
    },
  };
}

function writeFileWithMtime(filePath: string, contents: string, mtimeMs: number): void {
  fs.writeFileSync(filePath, contents);
  const time = new Date(mtimeMs);
  fs.utimesSync(filePath, time, time);
}

describe('checkBundleFreshness (Phase 4.6)', () => {
  let layout: ReturnType<typeof makeTmpLayout>;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    layout = makeTmpLayout();
    warn = vi.fn();
  });

  afterEach(() => {
    fs.rmSync(layout.root, { recursive: true, force: true });
  });

  it('warns with BOTH mtimes when dashboard is > 60s older than server', () => {
    const serverMtime = Date.now();
    const dashboardMtime = serverMtime - 10 * 60 * 1000; // 10 minutes older

    writeFileWithMtime(layout.paths.dashboardIndexHtml, '<html/>', dashboardMtime);
    writeFileWithMtime(
      path.join(layout.paths.dashboardAssetsDir, 'main.js'),
      'console.log(1)',
      dashboardMtime
    );
    writeFileWithMtime(layout.paths.serverBundle, 'module.exports={}', serverMtime);

    checkBundleFreshness(layout.paths, warn);

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('dashboard bundle appears stale');
    expect(msg).toContain('npm run build:web');
    expect(msg).toContain(new Date(dashboardMtime).toISOString());
    expect(msg).toContain(new Date(serverMtime).toISOString());
  });

  it('does NOT warn when dashboard is fresh (within the 60s grace window)', () => {
    const serverMtime = Date.now();
    const dashboardMtime = serverMtime - 10_000; // only 10s older

    writeFileWithMtime(layout.paths.dashboardIndexHtml, '<html/>', dashboardMtime);
    writeFileWithMtime(
      path.join(layout.paths.dashboardAssetsDir, 'main.js'),
      'console.log(1)',
      dashboardMtime
    );
    writeFileWithMtime(layout.paths.serverBundle, 'module.exports={}', serverMtime);

    checkBundleFreshness(layout.paths, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT warn when dashboard is newer than server', () => {
    const base = Date.now();
    writeFileWithMtime(layout.paths.dashboardIndexHtml, '<html/>', base + 5_000);
    writeFileWithMtime(
      path.join(layout.paths.dashboardAssetsDir, 'main.js'),
      'console.log(1)',
      base + 5_000
    );
    writeFileWithMtime(layout.paths.serverBundle, 'module.exports={}', base);

    checkBundleFreshness(layout.paths, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the NEWEST .js asset mtime when assets dir has multiple files', () => {
    const serverMtime = Date.now();
    // Old file + fresh file — freshest wins, within grace window.
    const oldMtime = serverMtime - 10 * 60 * 1000;
    const freshMtime = serverMtime - 10_000;

    writeFileWithMtime(layout.paths.dashboardIndexHtml, '<html/>', freshMtime);
    writeFileWithMtime(path.join(layout.paths.dashboardAssetsDir, 'chunk-old.js'), 'old', oldMtime);
    writeFileWithMtime(
      path.join(layout.paths.dashboardAssetsDir, 'chunk-new.js'),
      'new',
      freshMtime
    );
    writeFileWithMtime(layout.paths.serverBundle, 'module.exports={}', serverMtime);

    checkBundleFreshness(layout.paths, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is silent when dashboard index.html is missing (dev / Vite mode)', () => {
    const serverMtime = Date.now();
    // No index.html written.
    writeFileWithMtime(
      path.join(layout.paths.dashboardAssetsDir, 'main.js'),
      'x',
      serverMtime - 10 * 60 * 1000
    );
    writeFileWithMtime(layout.paths.serverBundle, 'module.exports={}', serverMtime);

    checkBundleFreshness(layout.paths, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is silent when assets dir has no .js files', () => {
    const serverMtime = Date.now();
    writeFileWithMtime(layout.paths.dashboardIndexHtml, '<html/>', serverMtime - 10 * 60 * 1000);
    writeFileWithMtime(layout.paths.serverBundle, 'module.exports={}', serverMtime);
    // assetsDir exists but is empty.

    checkBundleFreshness(layout.paths, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is silent when the server bundle is missing', () => {
    const t = Date.now();
    writeFileWithMtime(layout.paths.dashboardIndexHtml, '<html/>', t);
    writeFileWithMtime(path.join(layout.paths.dashboardAssetsDir, 'main.js'), 'x', t);
    // No server bundle written.

    checkBundleFreshness(layout.paths, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never throws on completely missing paths', () => {
    const bogus: BundleCheckPaths = {
      dashboardIndexHtml: path.join(layout.root, 'no', 'such', 'index.html'),
      dashboardAssetsDir: path.join(layout.root, 'no', 'such', 'assets'),
      serverBundle: path.join(layout.root, 'no', 'such', 'index.js'),
    };
    expect(() => checkBundleFreshness(bogus, warn)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('never throws on garbage input paths (empty strings)', () => {
    const bogus: BundleCheckPaths = {
      dashboardIndexHtml: '',
      dashboardAssetsDir: '',
      serverBundle: '',
    };
    expect(() => checkBundleFreshness(bogus, warn)).not.toThrow();
  });
});
