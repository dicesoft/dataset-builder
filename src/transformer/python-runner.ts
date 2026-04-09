/**
 * Generic Python subprocess runner for CV transforms
 * Follows the runCommand() pattern from src/scrapy/runner.ts
 */

import { spawn } from 'child_process';

export interface PythonRunResult {
  success: boolean;
  output: string;
  error: string;
  jsonOutput: unknown | null;
}

export interface PythonRunOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Run a Python script and capture its output
 * Parses JSON from stdout if possible
 */
export async function runPythonScript(
  scriptPath: string,
  args: string[],
  opts: PythonRunOptions = {}
): Promise<PythonRunResult> {
  const python = await findPython();
  if (!python) {
    return {
      success: false,
      output: '',
      error: 'Python not found. Please install Python 3.8+ and ensure it is on PATH.',
      jsonOutput: null,
    };
  }

  const timeout = opts.timeout ?? 120_000;

  return new Promise((resolve) => {
    const proc = spawn(python, [scriptPath, ...args], {
      cwd: opts.cwd || process.cwd(),
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          success: false,
          output: stdout,
          error: `Python script timed out after ${timeout}ms`,
          jsonOutput: null,
        });
        return;
      }

      // Try to parse JSON from stdout
      let jsonOutput: unknown | null = null;
      try {
        jsonOutput = JSON.parse(stdout.trim());
      } catch {
        // Not JSON — that's fine
      }

      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || (code !== 0 ? `Process exited with code ${code}` : ''),
        jsonOutput,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: stdout,
        error: err.message,
        jsonOutput: null,
      });
    });
  });
}

/**
 * Find a working Python executable
 * Checks python3 first, then python
 */
export async function findPython(): Promise<string | null> {
  for (const cmd of ['python3', 'python']) {
    try {
      const result = await testPython(cmd);
      if (result) return cmd;
    } catch {
      // Try next
    }
  }
  return null;
}

/**
 * Check if a Python package is importable
 */
export async function checkPythonPackage(pkg: string): Promise<boolean> {
  const python = await findPython();
  if (!python) return false;

  return new Promise((resolve) => {
    const proc = spawn(python, ['-c', `import ${pkg}`], { shell: false });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Test if a python command works and is Python 3
 */
function testPython(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, ['--version'], { shell: false });
    let output = '';

    proc.stdout?.on('data', (d) => {
      output += d.toString();
    });
    proc.stderr?.on('data', (d) => {
      output += d.toString();
    });

    proc.on('close', (code) => {
      resolve(code === 0 && output.includes('Python 3'));
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
