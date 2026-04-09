/**
 * Concurrency queue for limiting parallel async operations.
 * Used primarily to control Ollama request parallelism.
 */

import { getConfig } from '../config';

export interface ConcurrencyQueueOptions {
  concurrency: number;
  abortSignal?: { aborted: boolean };
}

interface QueueEntry {
  resolve: () => void;
  priority: number;
}

export interface QueueStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
}

export class ConcurrencyQueue {
  private readonly concurrency: number;
  private readonly abortSignal?: { aborted: boolean };
  private running = 0;
  private readonly queue: QueueEntry[] = [];
  private _completed = 0;
  private _failed = 0;

  constructor(options: ConcurrencyQueueOptions) {
    this.concurrency = Math.max(1, options.concurrency);
    this.abortSignal = options.abortSignal;
  }

  /** Get current queue statistics */
  get stats(): QueueStats {
    return {
      running: this.running,
      queued: this.queue.length,
      completed: this._completed,
      failed: this._failed,
    };
  }

  private releaseOne(): void {
    if (this.queue.length > 0) {
      // Pick highest priority (lowest number = highest priority)
      let bestIdx = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority < this.queue[bestIdx].priority) {
          bestIdx = i;
        }
      }
      const next = this.queue.splice(bestIdx, 1)[0];
      next.resolve();
    }
  }

  /** Run a single async function respecting the concurrency limit */
  async run<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    if (this.abortSignal?.aborted) {
      throw new Error('Aborted');
    }

    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push({ resolve, priority });
      });
    }

    // Re-check after waiting in queue — release next waiter before throwing
    if (this.abortSignal?.aborted) {
      this.releaseOne();
      throw new Error('Aborted');
    }

    this.running++;
    try {
      const result = await fn();
      this._completed++;
      return result;
    } catch (error) {
      this._failed++;
      throw error;
    } finally {
      this.running--;
      this.releaseOne();
    }
  }

  /** Wait for all queued and running work to complete */
  async drain(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Map items through fn with concurrency control, preserving order */
  async map<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    const promises = items.map((item, i) =>
      this.run(async () => {
        results[i] = await fn(item, i);
      })
    );
    await Promise.all(promises);
    return results;
  }

  /** Map items through fn, returning settled results (partial failures don't kill the batch) */
  async mapSettled<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>
  ): Promise<PromiseSettledResult<R>[]> {
    const promises = items.map((item, i) =>
      this.run(() => fn(item, i)).then(
        (value): PromiseSettledResult<R> => ({ status: 'fulfilled', value }),
        (reason): PromiseSettledResult<R> => ({ status: 'rejected', reason })
      )
    );
    return Promise.all(promises);
  }
}

/** Create a ConcurrencyQueue configured from app settings */
export function createOllamaQueue(
  type: 'text' | 'vision',
  overrides?: { concurrency?: number; abortSignal?: { aborted: boolean } }
): ConcurrencyQueue {
  const config = getConfig();
  const concurrency =
    overrides?.concurrency ??
    (type === 'vision' ? config.get('ollamaVisionConcurrency') : config.get('ollamaConcurrency')) ??
    4;

  return new ConcurrencyQueue({
    concurrency,
    abortSignal: overrides?.abortSignal,
  });
}
