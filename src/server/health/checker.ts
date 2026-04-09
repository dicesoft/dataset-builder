/**
 * T016: Health checker
 * Checks availability of external dependencies (Ollama, Python, Scrapy, ffmpeg, yt-dlp)
 */

import { execFile } from 'child_process';
import http from 'http';
import https from 'https';
import { getConfig } from '../../config';

export interface DependencyStatus {
  name: string;
  available: boolean;
  version: string | null;
  lastCheckedAt: string;
  error: string | null;
  requiredBy: string[];
}

/**
 * Mapping of which CLI commands require which dependencies
 */
const DEPENDENCY_REQUIRED_BY: Record<string, string[]> = {
  ollama: ['generate', 'transform', 'clean', 'translate'],
  python: ['scrape'],
  scrapy: ['scrape'],
  ffmpeg: ['compress'],
  'yt-dlp': ['scrape'],
};

/**
 * Cache of last health check results
 */
let cachedResults: DependencyStatus[] | null = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Run a subprocess and capture its stdout/stderr
 */
function execAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

/**
 * Check Ollama availability via HTTP GET to /api/tags
 */
async function checkOllama(): Promise<DependencyStatus> {
  const config = getConfig();
  const ollamaUrl = config.get('ollamaUrl');
  const now = new Date().toISOString();

  try {
    const version = await new Promise<string>((resolve, reject) => {
      const url = new URL('/api/tags', ollamaUrl);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.get(url.toString(), { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve('available');
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });
    });

    return {
      name: 'ollama',
      available: true,
      version,
      lastCheckedAt: now,
      error: null,
      requiredBy: DEPENDENCY_REQUIRED_BY['ollama'],
    };
  } catch (err) {
    return {
      name: 'ollama',
      available: false,
      version: null,
      lastCheckedAt: now,
      error: err instanceof Error ? err.message : String(err),
      requiredBy: DEPENDENCY_REQUIRED_BY['ollama'],
    };
  }
}

/**
 * Check Python availability
 */
async function checkPython(): Promise<DependencyStatus> {
  const now = new Date().toISOString();

  try {
    const { stdout, stderr } = await execAsync('python', ['--version']);
    const output = (stdout || stderr).trim();
    const versionMatch = output.match(/Python\s+([\d.]+)/);

    return {
      name: 'python',
      available: true,
      version: versionMatch ? versionMatch[1] : output,
      lastCheckedAt: now,
      error: null,
      requiredBy: DEPENDENCY_REQUIRED_BY['python'],
    };
  } catch (err) {
    return {
      name: 'python',
      available: false,
      version: null,
      lastCheckedAt: now,
      error: err instanceof Error ? err.message : 'not found in PATH',
      requiredBy: DEPENDENCY_REQUIRED_BY['python'],
    };
  }
}

/**
 * Check Scrapy availability
 */
async function checkScrapy(): Promise<DependencyStatus> {
  const now = new Date().toISOString();

  try {
    const { stdout } = await execAsync('scrapy', ['version']);
    const output = stdout.trim();
    const versionMatch = output.match(/Scrapy\s+([\d.]+)/);

    return {
      name: 'scrapy',
      available: true,
      version: versionMatch ? versionMatch[1] : output,
      lastCheckedAt: now,
      error: null,
      requiredBy: DEPENDENCY_REQUIRED_BY['scrapy'],
    };
  } catch (err) {
    return {
      name: 'scrapy',
      available: false,
      version: null,
      lastCheckedAt: now,
      error: err instanceof Error ? err.message : 'not found in PATH',
      requiredBy: DEPENDENCY_REQUIRED_BY['scrapy'],
    };
  }
}

/**
 * Check ffmpeg availability
 */
async function checkFfmpeg(): Promise<DependencyStatus> {
  const now = new Date().toISOString();

  try {
    const { stdout, stderr } = await execAsync('ffmpeg', ['-version']);
    const output = (stdout || stderr).trim();
    const versionMatch = output.match(/ffmpeg version\s+([\w.\-]+)/);

    return {
      name: 'ffmpeg',
      available: true,
      version: versionMatch ? versionMatch[1] : 'available',
      lastCheckedAt: now,
      error: null,
      requiredBy: DEPENDENCY_REQUIRED_BY['ffmpeg'],
    };
  } catch (err) {
    return {
      name: 'ffmpeg',
      available: false,
      version: null,
      lastCheckedAt: now,
      error: err instanceof Error ? err.message : 'not found in PATH',
      requiredBy: DEPENDENCY_REQUIRED_BY['ffmpeg'],
    };
  }
}

/**
 * Check yt-dlp availability
 */
async function checkYtDlp(): Promise<DependencyStatus> {
  const now = new Date().toISOString();

  try {
    const { stdout } = await execAsync('yt-dlp', ['--version']);
    const version = stdout.trim();

    return {
      name: 'yt-dlp',
      available: true,
      version: version || 'available',
      lastCheckedAt: now,
      error: null,
      requiredBy: DEPENDENCY_REQUIRED_BY['yt-dlp'],
    };
  } catch (err) {
    return {
      name: 'yt-dlp',
      available: false,
      version: null,
      lastCheckedAt: now,
      error: err instanceof Error ? err.message : 'not found in PATH',
      requiredBy: DEPENDENCY_REQUIRED_BY['yt-dlp'],
    };
  }
}

/**
 * Check all dependencies and return their statuses
 * Results are cached for 1 minute unless force=true
 */
export async function checkAllDependencies(force = false): Promise<DependencyStatus[]> {
  const now = Date.now();

  if (!force && cachedResults && now - lastCheckTime < CACHE_TTL_MS) {
    return cachedResults;
  }

  const results = await Promise.all([
    checkOllama(),
    checkPython(),
    checkScrapy(),
    checkFfmpeg(),
    checkYtDlp(),
  ]);

  cachedResults = results;
  lastCheckTime = now;

  return results;
}

/**
 * Check if all required dependencies for a command are available.
 * When options are provided, skips dependency checks for features that are not enabled.
 * For example, `clean` only needs Ollama if LLM/vision features are enabled.
 */
export async function checkDependenciesForCommand(
  command: string,
  options?: Record<string, unknown>
): Promise<{ ok: boolean; missing: DependencyStatus[] }> {
  const statuses = await checkAllDependencies();

  const missing = statuses.filter((dep) => {
    if (!dep.requiredBy.includes(command) || dep.available) return false;

    // Option-aware checks: skip deps that aren't needed for the enabled options
    if (options) {
      if (dep.name === 'ollama') {
        if (command === 'clean') {
          // Ollama only needed if LLM filter, math verify, fact check, or vision filter is enabled
          const needsOllama =
            options.llmFilter || options.verifyMath || options.factCheck || options.visionFilter;
          if (!needsOllama) return false;
        }
        // generate, transform, translate always need Ollama — no skip
      }

      if (dep.name === 'python' || dep.name === 'scrapy') {
        // Only scrape needs these — no conditional skip for scrape
      }

      if (dep.name === 'ffmpeg') {
        // Only compress needs this — no conditional skip
      }
    }

    return true;
  });

  return { ok: missing.length === 0, missing };
}

/**
 * Clear the cached results
 */
export function clearCache(): void {
  cachedResults = null;
  lastCheckTime = 0;
}

// ---------------------------------------------------------------------------
// HealthChecker class — OOP wrapper used by route plugins
// ---------------------------------------------------------------------------

export interface HealthReport {
  healthy: boolean;
  dependencies: DependencyStatus[];
  checkedAt: string;
}

export class HealthChecker {
  /**
   * Get the cached health report (or run checks if stale)
   */
  async getReport(): Promise<HealthReport> {
    const deps = await checkAllDependencies();
    const healthy = deps.every((d) => d.available);
    return {
      healthy,
      dependencies: deps,
      checkedAt: deps[0]?.lastCheckedAt || new Date().toISOString(),
    };
  }

  /**
   * Force a fresh health check (bypass cache)
   */
  async refresh(): Promise<HealthReport> {
    clearCache();
    const deps = await checkAllDependencies(true);
    const healthy = deps.every((d) => d.available);
    return {
      healthy,
      dependencies: deps,
      checkedAt: deps[0]?.lastCheckedAt || new Date().toISOString(),
    };
  }
}
