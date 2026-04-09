/**
 * Formatter Performance Benchmark
 * Generates 10,000 synthetic records and benchmarks each formatter.
 * Run via: npx tsx scripts/benchmark-formatters.ts
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { formatDataset } from '../src/formatters/index';

const RECORD_COUNT = 10_000;
const MAX_TEXT_TIME_MS = 30_000; // 30 seconds for text formatters

/**
 * Generate synthetic instruction/output records
 */
function generateRecords(count: number): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      instruction: `Question ${i}: What is the explanation for concept number ${i} in the field of artificial intelligence and machine learning?`,
      input:
        i % 3 === 0
          ? `Context for question ${i}: This relates to advanced topics in deep learning.`
          : '',
      output: `Answer ${i}: Concept ${i} refers to a fundamental principle in AI/ML that involves processing data through multiple layers of abstraction to extract meaningful patterns and representations.`,
    });
  }
  return records;
}

/**
 * Generate HuggingFace-style records
 */
function generateHFRecords(count: number): Record<string, unknown>[] {
  const categories = ['tech', 'science', 'finance', 'politics', 'health'];
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      id: i + 1,
      text: `Record ${i}: This is a sample text entry about ${categories[i % categories.length]} with enough content to simulate real data.`,
      category: categories[i % categories.length],
      score: Math.round((0.5 + Math.random() * 0.5) * 100) / 100,
    });
  }
  return records;
}

interface BenchmarkResult {
  formatter: string;
  records: number;
  timeMs: number;
  recordsPerSec: number;
  passed: boolean;
}

async function benchmarkFormatter(
  name: string,
  data: Record<string, unknown>[],
  extraOptions: Record<string, unknown> = {}
): Promise<BenchmarkResult> {
  const tmpDir = path.join(os.tmpdir(), `fmt-bench-${name}-${Date.now()}`);
  const start = performance.now();

  try {
    await formatDataset({
      inputData: data,
      formatter: name,
      outputDir: tmpDir,
      fieldMap: {},
      ...extraOptions,
    });
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  const elapsed = performance.now() - start;
  const isText = ['alpaca', 'chatml', 'sharegpt', 'oasst', 'raw'].includes(name);
  const threshold = isText ? MAX_TEXT_TIME_MS : Infinity;

  return {
    formatter: name,
    records: data.length,
    timeMs: Math.round(elapsed),
    recordsPerSec: Math.round(data.length / (elapsed / 1000)),
    passed: elapsed < threshold,
  };
}

async function main() {
  console.log(`\nFormatter Performance Benchmark`);
  console.log(`==============================`);
  console.log(`Records: ${RECORD_COUNT.toLocaleString()}`);
  console.log(`Text formatter threshold: ${MAX_TEXT_TIME_MS / 1000}s\n`);

  const textRecords = generateRecords(RECORD_COUNT);
  const hfRecords = generateHFRecords(RECORD_COUNT);

  const benchmarks: Array<{
    name: string;
    data: Record<string, unknown>[];
    opts?: Record<string, unknown>;
  }> = [
    // Text formatters
    { name: 'alpaca', data: textRecords },
    { name: 'chatml', data: textRecords },
    { name: 'sharegpt', data: textRecords },
    { name: 'oasst', data: textRecords },
    { name: 'raw', data: textRecords },
    // HuggingFace formatters
    {
      name: 'datasetdict',
      data: hfRecords,
      opts: { splitRatios: [0.8, 0.1, 0.1] as [number, number, number] },
    },
    {
      name: 'parquet',
      data: hfRecords,
      opts: { splitRatios: [0.8, 0.1, 0.1] as [number, number, number] },
    },
  ];

  const results: BenchmarkResult[] = [];

  for (const bench of benchmarks) {
    process.stdout.write(`  Benchmarking ${bench.name}...`);
    try {
      const result = await benchmarkFormatter(bench.name, bench.data, bench.opts);
      results.push(result);
      console.log(` ${result.passed ? 'PASS' : 'FAIL'}`);
    } catch (err) {
      console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        formatter: bench.name,
        records: bench.data.length,
        timeMs: -1,
        recordsPerSec: 0,
        passed: false,
      });
    }
  }

  // Print results table
  console.log(
    `\n${'Formatter'.padEnd(15)} ${'Records'.padStart(10)} ${'Time (ms)'.padStart(12)} ${'Rec/sec'.padStart(12)} ${'Status'.padStart(8)}`
  );
  console.log('-'.repeat(60));
  for (const r of results) {
    const status = r.timeMs < 0 ? 'ERROR' : r.passed ? 'PASS' : 'FAIL';
    console.log(
      `${r.formatter.padEnd(15)} ${r.records.toLocaleString().padStart(10)} ${r.timeMs.toLocaleString().padStart(12)} ${r.recordsPerSec.toLocaleString().padStart(12)} ${status.padStart(8)}`
    );
  }

  const allPassed = results.every((r) => r.passed);
  console.log(`\n${allPassed ? 'All benchmarks passed.' : 'Some benchmarks failed.'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
