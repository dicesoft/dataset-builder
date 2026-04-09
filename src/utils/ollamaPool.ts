/**
 * Multi-instance Ollama pool for distributed LLM processing.
 * Provides load balancing, health checks, and failover across multiple Ollama servers.
 * Falls back to single-instance when ollamaInstances is not configured.
 */

import { OllamaClient, getOllama } from '../generators/ollama';
import { getConfig, type OllamaInstanceConfig } from '../config';
import { CLIError, ErrorCodes } from './errorCodes';
import { ExitCode } from './exitCodes';

export interface PooledInstance {
  client: OllamaClient;
  url: string;
  activeConnections: number;
  healthy: boolean;
  weight: number;
  maxParallel: number;
  models?: string[];
}

export interface PoolStats {
  totalInstances: number;
  healthyInstances: number;
  totalActiveConnections: number;
  totalCapacity: number;
  instanceStats: Array<{
    url: string;
    healthy: boolean;
    activeConnections: number;
    maxParallel: number;
  }>;
}

export class OllamaPool {
  private instances: PooledInstance[] = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private initialized = false;
  private fallbackClient?: OllamaClient;

  constructor(
    private instanceConfigs?: OllamaInstanceConfig[],
    private fallbackUrl?: string
  ) {}

  /** Initialize all instances and start health checks */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.instanceConfigs || this.instanceConfigs.length === 0) {
      // Single-instance fallback mode
      this.fallbackClient = getOllama(this.fallbackUrl);
      this.initialized = true;
      return;
    }

    // Create pooled instances
    for (const config of this.instanceConfigs) {
      const client = new OllamaClient(config.url);
      this.instances.push({
        client,
        url: config.url,
        activeConnections: 0,
        healthy: false,
        weight: config.weight ?? 1,
        maxParallel: config.maxParallel ?? 4,
        models: config.models,
      });
    }

    // Initial health check
    await this.checkHealth();

    // Start periodic health checks (every 10s)
    this.healthCheckInterval = setInterval(() => this.checkHealth(), 10000);

    this.initialized = true;
  }

  /** Check health of all instances */
  private async checkHealth(): Promise<void> {
    const checks = this.instances.map(async (inst) => {
      try {
        inst.healthy = await inst.client.ping();
      } catch {
        inst.healthy = false;
      }
    });
    await Promise.all(checks);
  }

  /**
   * Acquire an instance using least-connections load balancing.
   * Optionally filter by model availability.
   */
  async acquire(model?: string): Promise<PooledInstance> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Fallback mode: return singleton wrapper
    if (this.fallbackClient) {
      return {
        client: this.fallbackClient,
        url: getConfig().get('ollamaUrl') || 'http://localhost:11434',
        activeConnections: 0,
        healthy: true,
        weight: 1,
        maxParallel: getConfig().get('ollamaConcurrency') ?? 4,
      };
    }

    // Filter healthy instances
    let candidates = this.instances.filter((inst) => inst.healthy);

    // Filter by model if specified
    if (model && candidates.length > 0) {
      const modelCandidates = candidates.filter(
        (inst) => !inst.models || inst.models.length === 0 || inst.models.includes(model)
      );
      if (modelCandidates.length > 0) {
        candidates = modelCandidates;
      }
      // If no model-specific candidates, use any healthy instance
    }

    if (candidates.length === 0) {
      throw new CLIError(
        ErrorCodes.OLLAMA_UNAVAILABLE,
        'No healthy Ollama instances available. Check that your Ollama servers are running.',
        ExitCode.OLLAMA_UNAVAILABLE
      );
    }

    // Least-connections with weight: pick instance with lowest (active / weight / maxParallel)
    candidates.sort((a, b) => {
      const scoreA = a.activeConnections / (a.weight * a.maxParallel);
      const scoreB = b.activeConnections / (b.weight * b.maxParallel);
      return scoreA - scoreB;
    });

    const selected = candidates[0];
    selected.activeConnections++;
    return selected;
  }

  /** Release an instance back to the pool */
  release(instance: PooledInstance): void {
    if (this.fallbackClient) return; // No-op in fallback mode
    instance.activeConnections = Math.max(0, instance.activeConnections - 1);
  }

  /** Get pool statistics */
  getStats(): PoolStats {
    if (this.fallbackClient) {
      return {
        totalInstances: 1,
        healthyInstances: 1,
        totalActiveConnections: 0,
        totalCapacity: getConfig().get('ollamaConcurrency') ?? 4,
        instanceStats: [
          {
            url: getConfig().get('ollamaUrl') || 'http://localhost:11434',
            healthy: true,
            activeConnections: 0,
            maxParallel: getConfig().get('ollamaConcurrency') ?? 4,
          },
        ],
      };
    }

    return {
      totalInstances: this.instances.length,
      healthyInstances: this.instances.filter((i) => i.healthy).length,
      totalActiveConnections: this.instances.reduce((sum, i) => sum + i.activeConnections, 0),
      totalCapacity: this.instances.reduce((sum, i) => sum + i.maxParallel, 0),
      instanceStats: this.instances.map((i) => ({
        url: i.url,
        healthy: i.healthy,
        activeConnections: i.activeConnections,
        maxParallel: i.maxParallel,
      })),
    };
  }

  /** Pre-warm a model across all healthy instances */
  async warmupAll(model: string): Promise<void> {
    if (this.fallbackClient) {
      // Single-instance warmup
      const { warmupModel } = await import('./ollamaServer');
      await warmupModel(model);
      return;
    }

    const warmups = this.instances
      .filter((i) => i.healthy)
      .filter((i) => !i.models || i.models.length === 0 || i.models.includes(model))
      .map(async (inst) => {
        try {
          await inst.client.generate({
            model,
            prompt: 'hi',
            num_predict: 1,
          });
        } catch {
          // Warmup failure is non-fatal
        }
      });

    await Promise.all(warmups);
  }

  /** Stop health checks and clean up */
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    this.instances = [];
    this.fallbackClient = undefined;
    this.initialized = false;
  }
}

// Singleton pool instance
let poolInstance: OllamaPool | null = null;

/** Get or create the global OllamaPool */
export function getOllamaPool(): OllamaPool {
  if (!poolInstance) {
    const config = getConfig();
    const instances = config.get('ollamaInstances');
    poolInstance = new OllamaPool(instances, config.get('ollamaUrl'));
  }
  return poolInstance;
}

/** Reset the global pool (for testing) */
export function resetOllamaPool(): void {
  if (poolInstance) {
    poolInstance.shutdown();
    poolInstance = null;
  }
}
