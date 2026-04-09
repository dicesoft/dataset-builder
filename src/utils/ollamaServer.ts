/**
 * Ollama server configuration and lifecycle management.
 * Automatically sets OLLAMA_NUM_PARALLEL and restarts the server
 * when concurrency > 1 is detected.
 */

import { getConfig } from '../config';
import { execSync, spawn } from 'child_process';
import chalk from 'chalk';
import { isJsonMode } from './output';

export interface OllamaServerConfig {
  numParallel: number;
  maxLoadedModels?: number;
  maxQueue?: number;
}

/** Information about a currently loaded model from `ollama ps` */
export interface LoadedModelInfo {
  name: string;
  size: string;
  processor: string;
  until: string;
}

/** VRAM/memory info for concurrency planning */
export interface VramInfo {
  loadedModels: LoadedModelInfo[];
  suggestedParallel: number;
  warning?: string;
}

/** Calculate needed server config from our concurrency settings */
export function calculateNeededConfig(overrides?: {
  ollamaConcurrency?: number;
  ollamaVisionConcurrency?: number;
}): OllamaServerConfig {
  const config = getConfig();
  const textConcurrency = overrides?.ollamaConcurrency ?? config.get('ollamaConcurrency') ?? 4;
  const visionConcurrency =
    overrides?.ollamaVisionConcurrency ?? config.get('ollamaVisionConcurrency') ?? 2;
  const numParallel = Math.max(textConcurrency, visionConcurrency);

  // Set maxLoadedModels if configured or if using both text + vision models
  const maxLoadedModels = config.get('ollamaMaxLoadedModels');
  const ollamaModel = config.get('ollamaModel');
  const visionModel = config.get('ollamaVisionModel');
  const classifyModel = config.get('ollamaClassifyModel');
  const generateModel = config.get('ollamaGenerateModel');

  // Count unique models that might be loaded simultaneously
  const uniqueModels = new Set(
    [ollamaModel, visionModel, classifyModel, generateModel].filter(Boolean)
  );

  return {
    numParallel,
    maxLoadedModels: maxLoadedModels ?? (uniqueModels.size > 1 ? uniqueModels.size : undefined),
    maxQueue: numParallel * 4,
  };
}

/** Check if Ollama server is currently running */
async function isOllamaRunning(): Promise<boolean> {
  try {
    const config = getConfig();
    const url = config.get('ollamaUrl') || 'http://localhost:11434';
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Wait for Ollama to become healthy */
async function waitForOllama(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaRunning()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Stop the Ollama process */
function stopOllama(): void {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      execSync('taskkill /F /IM ollama.exe 2>nul', { stdio: 'ignore' });
      // Also kill ollama_runners / ollama app if present
      execSync('taskkill /F /IM "ollama app.exe" 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -f ollama 2>/dev/null || true', { stdio: 'ignore' });
    }
  } catch {
    // Process may not be running
  }
}

/** Start Ollama serve in background with env vars */
function startOllama(config: OllamaServerConfig): void {
  const env: Record<string, string | undefined> = {
    ...process.env,
    OLLAMA_NUM_PARALLEL: String(config.numParallel),
    OLLAMA_MAX_QUEUE: String(config.maxQueue ?? config.numParallel * 4),
  };
  if (config.maxLoadedModels) {
    env.OLLAMA_MAX_LOADED_MODELS = String(config.maxLoadedModels);
  }

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'ollama' : 'ollama';
  const child = spawn(cmd, ['serve'], {
    env,
    stdio: 'ignore',
    detached: !isWin,
    shell: isWin,
  });
  child.unref();
}

/**
 * Query loaded models and their resource usage via `ollama ps`
 */
export async function queryLoadedModels(): Promise<LoadedModelInfo[]> {
  try {
    const config = getConfig();
    const url = config.get('ollamaUrl') || 'http://localhost:11434';
    const response = await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: Array<Record<string, unknown>> };
    if (!data.models) return [];
    return data.models.map((m) => ({
      name: String(m.name || ''),
      size: String(m.size || ''),
      processor: String(
        (m.details as Record<string, unknown>)?.processor || m.processor || 'unknown'
      ),
      until: String(m.expires_at || ''),
    }));
  } catch {
    return [];
  }
}

/**
 * Auto-detect optimal concurrency based on loaded models and available resources.
 * Queries `ollama ps` and suggests safe NUM_PARALLEL values.
 */
export async function autoTuneConcurrency(): Promise<VramInfo> {
  const loadedModels = await queryLoadedModels();

  // Default suggestion: conservative
  let suggestedParallel = 4;
  let warning: string | undefined;

  if (loadedModels.length === 0) {
    // No models loaded yet — suggest moderate concurrency
    suggestedParallel = 4;
  } else {
    // Check if any models are using GPU
    const gpuModels = loadedModels.filter(
      (m) => m.processor.includes('GPU') || m.processor.includes('gpu')
    );

    if (gpuModels.length > 0) {
      // With GPU models, be more conservative since VRAM is limited
      // Each parallel slot allocates context_length worth of memory
      suggestedParallel = gpuModels.length > 1 ? 2 : 4;
      if (gpuModels.length > 2) {
        warning = `${gpuModels.length} GPU models loaded — reduce concurrency to avoid OOM`;
        suggestedParallel = 2;
      }
    } else {
      // CPU-only: more parallelism is fine, limited by CPU cores
      suggestedParallel = 8;
    }
  }

  return { loadedModels, suggestedParallel, warning };
}

/**
 * Pre-warm a model by sending a trivial generation request.
 * This forces the model to load into VRAM/RAM before real work begins.
 */
export async function warmupModel(model: string): Promise<boolean> {
  try {
    const config = getConfig();
    const url = config.get('ollamaUrl') || 'http://localhost:11434';

    console.log(chalk.gray(`  Warming up model: ${model}`));
    const response = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'hi',
        stream: false,
        options: { num_predict: 1 },
      }),
      signal: AbortSignal.timeout(120000), // Models can take a while to load
    });

    if (response.ok) {
      console.log(chalk.green(`  Model ${model} warmed up`));
      return true;
    } else {
      const errorText = await response.text();
      console.log(chalk.yellow(`  Warmup failed for ${model}: ${errorText}`));
      return false;
    }
  } catch (error) {
    console.log(
      chalk.yellow(
        `  Warmup failed for ${model}: ${error instanceof Error ? error.message : error}`
      )
    );
    return false;
  }
}

/**
 * Pre-warm all models that will be used in the current workflow.
 * Call before batch processing to eliminate cold-load penalty.
 */
export async function warmupModels(models: string[]): Promise<void> {
  const unique = [...new Set(models.filter(Boolean))];
  if (unique.length === 0) return;

  console.log(chalk.blue(`Pre-warming ${unique.length} model(s)...`));
  // Warm models sequentially to avoid memory spikes
  for (const model of unique) {
    await warmupModel(model);
  }
}

/**
 * Configure Ollama server and restart if needed.
 * Only restarts when numParallel > 1 (default sequential needs no special config).
 */
export async function syncOllamaServer(overrides?: {
  ollamaConcurrency?: number;
  ollamaVisionConcurrency?: number;
}): Promise<void> {
  const needed = calculateNeededConfig(overrides);

  if (needed.numParallel <= 1) {
    return; // No special config needed for sequential mode
  }

  const configParts = [`NUM_PARALLEL=${needed.numParallel}`, `MAX_QUEUE=${needed.maxQueue}`];
  if (needed.maxLoadedModels) {
    configParts.push(`MAX_LOADED_MODELS=${needed.maxLoadedModels}`);
  }

  if (!isJsonMode()) {
    console.log(chalk.blue(`Configuring Ollama server: ${configParts.join(', ')}`));

    // Log estimated VRAM impact
    console.log(
      chalk.gray(`  Memory impact: ${needed.numParallel} parallel slots × context_length per slot`)
    );
  }

  // Also set process env so any in-process Ollama calls inherit them
  process.env.OLLAMA_NUM_PARALLEL = String(needed.numParallel);
  process.env.OLLAMA_MAX_QUEUE = String(needed.maxQueue ?? needed.numParallel * 4);
  if (needed.maxLoadedModels) {
    process.env.OLLAMA_MAX_LOADED_MODELS = String(needed.maxLoadedModels);
  }

  // Stop existing Ollama
  stopOllama();
  // Brief pause to let process fully exit
  await new Promise((r) => setTimeout(r, 1000));

  // Start with new config
  startOllama(needed);

  // Wait for health check
  const healthy = await waitForOllama();
  if (!isJsonMode()) {
    if (healthy) {
      console.log(chalk.green('Ollama server restarted with parallel config'));
    } else {
      console.log(
        chalk.yellow('Ollama server may not have started. Continuing with env vars set...')
      );
    }
  }
}
