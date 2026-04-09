import { describe, it, expect, vi } from 'vitest';
import { ConcurrencyQueue } from './concurrency';

describe('ConcurrencyQueue', () => {
  it('concurrency=1 runs sequentially', async () => {
    const queue = new ConcurrencyQueue({ concurrency: 1 });
    const order: number[] = [];

    await queue.map([1, 2, 3], async (item) => {
      order.push(item);
      await new Promise((r) => setTimeout(r, 10));
      return item;
    });

    expect(order).toEqual([1, 2, 3]);
  });

  it('concurrency=3 runs at most 3 simultaneously', async () => {
    const queue = new ConcurrencyQueue({ concurrency: 3 });
    let maxConcurrent = 0;
    let current = 0;

    await queue.map([1, 2, 3, 4, 5, 6], async (item) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 50));
      current--;
      return item;
    });

    expect(maxConcurrent).toBe(3);
  });

  it('map preserves order', async () => {
    const queue = new ConcurrencyQueue({ concurrency: 3 });
    // Items with variable delays to ensure ordering is tested
    const results = await queue.map([1, 2, 3, 4, 5], async (item) => {
      await new Promise((r) => setTimeout(r, (6 - item) * 10)); // reverse delay
      return item * 2;
    });

    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('mapSettled returns all results even with failures', async () => {
    const queue = new ConcurrencyQueue({ concurrency: 2 });
    const results = await queue.mapSettled([1, 2, 3, 4], async (item) => {
      if (item === 2 || item === 4) throw new Error(`fail-${item}`);
      return item * 10;
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 10 });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 30 });
    expect(results[3].status).toBe('rejected');
  });

  it('abort signal stops new items from starting', async () => {
    const signal = { aborted: false };
    const queue = new ConcurrencyQueue({ concurrency: 1, abortSignal: signal });
    const processed: number[] = [];

    // Use mapSettled so partial failures don't mask the behavior
    const results = await queue.mapSettled([1, 2, 3, 4, 5], async (item) => {
      processed.push(item);
      if (item === 2) signal.aborted = true;
      await new Promise((r) => setTimeout(r, 10));
      return item;
    });

    // Items 1 and 2 should be fulfilled, items 3+ should be rejected (aborted)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1]).toEqual({ status: 'fulfilled', value: 2 });
    const rejectedCount = results.filter((r) => r.status === 'rejected').length;
    expect(rejectedCount).toBeGreaterThanOrEqual(1);
    // Items 3-5 should not have been processed
    expect(processed.length).toBeLessThanOrEqual(2);
  });

  it('run respects concurrency limit', async () => {
    const queue = new ConcurrencyQueue({ concurrency: 2 });
    let current = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      queue.run(async () => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 30));
        current--;
        return i;
      })
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
