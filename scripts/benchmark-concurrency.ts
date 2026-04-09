/**
 * Live Concurrency Benchmark
 * Verifies that parallel LLM processing actually improves throughput
 * for `transform` and `clean` commands with real Ollama calls.
 *
 * Run via: npx tsx scripts/benchmark-concurrency.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// ─── Configuration ───────────────────────────────────────────────────────────

const TRANSFORM_RECORDS = 15; // Transform is multi-stage, needs fewer records
const CLEAN_RECORDS = 50;
const MIN_TEXT_LENGTH = 50;
const CONCURRENCY_LEVELS = [1, 2, 4];
const MODELS = ['qwen3.5:2b'];
const RUNS_PER_EXPERIMENT = 3;
const COOLDOWN_MS = 5000;
const CLI_TIMEOUT_MS = 900_000; // 15 minutes per run
const OLLAMA_URL = 'http://localhost:11434';

const SOURCE_DATA = path.resolve(
  'output/task_1772148359906_hdaf2nfkl/scraped_combined_1772148405404.json'
);
const BENCH_DIR = path.resolve('output/bench');
const BENCH_TRANSFORM_INPUT = path.join(BENCH_DIR, `bench_${TRANSFORM_RECORDS}.json`);
const BENCH_CLEAN_INPUT = path.join(BENCH_DIR, `bench_${CLEAN_RECORDS}.json`);

// ─── Types ───────────────────────────────────────────────────────────────────

interface BenchmarkResult {
  command: string;
  model: string;
  concurrency: number;
  run: number;
  elapsedSec: number;
  inputRecords: number;
  outputRecords: number;
  throughput: number; // input records / elapsed sec
  timedOut: boolean;
  error?: string;
}

interface AggregatedResult {
  command: string;
  model: string;
  concurrency: number;
  avgElapsedSec: number;
  minElapsedSec: number;
  maxElapsedSec: number;
  stdDev: number;
  avgThroughput: number;
  avgSpeedup: number;
  validRuns: number;
  totalRuns: number;
  timedOutRuns: number;
  runs: BenchmarkResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function isOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function pullModelIfNeeded(model: string): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const names = (data.models || []).map((m) => m.name);
      const found = names.some(
        (n) => n === model || n === `${model}:latest` || n.startsWith(`${model}:`)
      );
      if (found) {
        console.log(`  Model ${model} already available`);
        return;
      }
    }
  } catch {
    // fall through to pull
  }

  console.log(`  Pulling model ${model}...`);
  try {
    execSync(`ollama pull ${model}`, { stdio: 'inherit', timeout: 300000 });
    console.log(`  Model ${model} pulled successfully`);
  } catch (err) {
    throw new Error(`Failed to pull model ${model}: ${err}`);
  }
}

async function warmupModel(model: string): Promise<void> {
  console.log(`  Warming up ${model}...`);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'Say hello in one sentence.',
        stream: false,
        options: { num_predict: 20 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) {
      console.log(`  ${model} warmed up`);
    } else {
      console.log(`  Warmup response: ${res.status}`);
    }
  } catch (err) {
    console.log(`  Warmup failed: ${err}`);
  }
}

function prepareInputData(): { transformCount: number; cleanCount: number } {
  if (!fs.existsSync(SOURCE_DATA)) {
    throw new Error(`Source data not found: ${SOURCE_DATA}`);
  }

  fs.mkdirSync(BENCH_DIR, { recursive: true });

  const raw = JSON.parse(fs.readFileSync(SOURCE_DATA, 'utf-8'));
  const allRecords = (Array.isArray(raw) ? raw : [raw]).filter((r: any) => {
    const text = r.text || r.content || r.body || r.extracted_text || r.markdown || r.html || '';
    return typeof text === 'string' && text.length > MIN_TEXT_LENGTH;
  });

  if (allRecords.length === 0) {
    throw new Error('No records with sufficient text found in source data');
  }

  // Transform subset (smaller)
  const transformRecords = allRecords.slice(0, TRANSFORM_RECORDS);
  fs.writeFileSync(BENCH_TRANSFORM_INPUT, JSON.stringify(transformRecords, null, 2));
  console.log(`  Transform input: ${transformRecords.length} records → ${BENCH_TRANSFORM_INPUT}`);

  // Clean subset (larger)
  const cleanRecords = allRecords.slice(0, CLEAN_RECORDS);
  fs.writeFileSync(BENCH_CLEAN_INPUT, JSON.stringify(cleanRecords, null, 2));
  console.log(`  Clean input: ${cleanRecords.length} records → ${BENCH_CLEAN_INPUT}`);

  return { transformCount: transformRecords.length, cleanCount: cleanRecords.length };
}

function countOutputRecords(outputPath: string): number {
  try {
    if (!fs.existsSync(outputPath)) return 0;
    const content = fs.readFileSync(outputPath, 'utf-8').trim();
    if (!content) return 0;

    if (content.startsWith('[')) {
      return JSON.parse(content).length;
    }
    return content.split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function runCLI(args: string): { elapsed: number; stdout: string; timedOut: boolean } {
  const cmd = `npm start -- ${args}`;
  console.log(`    $ ${cmd}`);
  const start = Date.now();
  try {
    const stdout = execSync(cmd, {
      timeout: CLI_TIMEOUT_MS,
      encoding: 'utf-8',
      cwd: path.resolve('.'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const elapsed = Date.now() - start;
    return { elapsed, stdout, timedOut: false };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    const timedOut = err.killed || elapsed >= CLI_TIMEOUT_MS - 1000;
    const stdout = err.stdout?.toString() || '';
    const stderr = err.stderr?.toString() || '';
    if (timedOut) {
      console.log(`    TIMEOUT after ${(elapsed / 1000).toFixed(1)}s`);
    } else {
      console.log(`    Command failed (${(elapsed / 1000).toFixed(1)}s): ${stderr.slice(0, 200)}`);
    }
    return { elapsed, stdout, timedOut };
  }
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

function aggregateRuns(runs: BenchmarkResult[]): AggregatedResult {
  const validRuns = runs.filter((r) => !r.timedOut && !r.error);
  const timedOutRuns = runs.filter((r) => r.timedOut).length;

  if (validRuns.length === 0) {
    return {
      command: runs[0].command,
      model: runs[0].model,
      concurrency: runs[0].concurrency,
      avgElapsedSec: 0,
      minElapsedSec: 0,
      maxElapsedSec: 0,
      stdDev: 0,
      avgThroughput: 0,
      avgSpeedup: 0,
      validRuns: 0,
      totalRuns: runs.length,
      timedOutRuns,
      runs,
    };
  }

  const times = validRuns.map((r) => r.elapsedSec);
  const throughputs = validRuns.map((r) => r.throughput);

  return {
    command: runs[0].command,
    model: runs[0].model,
    concurrency: runs[0].concurrency,
    avgElapsedSec: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
    minElapsedSec: Math.min(...times),
    maxElapsedSec: Math.max(...times),
    stdDev: Math.round(stddev(times) * 100) / 100,
    avgThroughput:
      Math.round((throughputs.reduce((a, b) => a + b, 0) / throughputs.length) * 1000) / 1000,
    avgSpeedup: 0, // computed later relative to baseline
    validRuns: validRuns.length,
    totalRuns: runs.length,
    timedOutRuns,
    runs,
  };
}

// ─── Benchmark Runners ───────────────────────────────────────────────────────

function benchTransform(
  model: string,
  concurrency: number,
  inputCount: number,
  run: number
): BenchmarkResult {
  const outputDir = path.join(
    BENCH_DIR,
    `transform_${model.replace(/[:/]/g, '_')}_c${concurrency}`
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, 'transformed.json');
  // Clean previous output
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

  const args = [
    'transform',
    `-i "${BENCH_TRANSFORM_INPUT}"`,
    '-t text-qa',
    `-m ${model}`,
    `--ollama-concurrency ${concurrency}`,
    '--target "general knowledge"',
    '-y',
    '--force',
    `-o "${outputFile}"`,
  ].join(' ');

  const { elapsed, timedOut } = runCLI(args);
  const outputRecords = countOutputRecords(outputFile);
  const elapsedSec = elapsed / 1000;

  return {
    command: 'transform',
    model,
    concurrency,
    run,
    elapsedSec: Math.round(elapsedSec * 100) / 100,
    inputRecords: inputCount,
    outputRecords,
    throughput: elapsedSec > 0 ? Math.round((inputCount / elapsedSec) * 1000) / 1000 : 0,
    timedOut,
  };
}

function benchClean(
  model: string,
  concurrency: number,
  inputCount: number,
  run: number
): BenchmarkResult {
  const outputFile = path.join(
    BENCH_DIR,
    `clean_${model.replace(/[:/]/g, '_')}_c${concurrency}.json`
  );

  // Clean previous output
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

  // Set the model in config before running clean (clean reads model from config)
  try {
    execSync(`npm start -- config set ollamaModel ${model}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch {
    console.log(`    Warning: could not set config model to ${model}`);
  }

  const args = [
    'clean',
    `-i "${BENCH_CLEAN_INPUT}"`,
    '--llm-filter',
    `--ollama-concurrency ${concurrency}`,
    '-y',
    `-o "${outputFile}"`,
  ].join(' ');

  const { elapsed, timedOut } = runCLI(args);
  const outputRecords = countOutputRecords(outputFile);
  const elapsedSec = elapsed / 1000;

  return {
    command: 'clean',
    model,
    concurrency,
    run,
    elapsedSec: Math.round(elapsedSec * 100) / 100,
    inputRecords: inputCount,
    outputRecords,
    throughput: elapsedSec > 0 ? Math.round((inputCount / elapsedSec) * 1000) / 1000 : 0,
    timedOut,
  };
}

// ─── Results Tables ─────────────────────────────────────────────────────────

function printAggregatedResults(aggregated: AggregatedResult[]): void {
  console.log('\n' + '='.repeat(120));
  console.log('CONCURRENCY BENCHMARK RESULTS (AVERAGED)');
  console.log('='.repeat(120));

  const header = [
    'Command'.padEnd(12),
    'Model'.padEnd(14),
    'Conc'.padStart(4),
    'Avg Time(s)'.padStart(11),
    'Min'.padStart(8),
    'Max'.padStart(8),
    'StdDev'.padStart(8),
    'Avg In/sec'.padStart(10),
    'Speedup'.padStart(9),
    'Runs'.padStart(6),
    'Status'.padStart(8),
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(120));

  // Group by command+model to calculate speedup
  const groups = new Map<string, AggregatedResult[]>();
  for (const r of aggregated) {
    const key = `${r.command}|${r.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  for (const [, group] of groups) {
    const baseline = group.find((r) => r.concurrency === 1);
    const baselineAvg = baseline?.avgElapsedSec || 1;

    for (const r of group) {
      const speedup = baselineAvg > 0 && r.avgElapsedSec > 0 ? baselineAvg / r.avgElapsedSec : 0;
      r.avgSpeedup = Math.round(speedup * 100) / 100;
      const speedupStr = r.concurrency === 1 ? '(base)' : `${speedup.toFixed(2)}x`;
      const status =
        r.validRuns === 0 ? 'FAIL' : r.timedOutRuns > 0 ? `${r.validRuns}/${r.totalRuns}OK` : 'OK';

      const row = [
        r.command.padEnd(12),
        r.model.padEnd(14),
        String(r.concurrency).padStart(4),
        r.avgElapsedSec.toFixed(1).padStart(11),
        r.minElapsedSec.toFixed(1).padStart(8),
        r.maxElapsedSec.toFixed(1).padStart(8),
        r.stdDev.toFixed(2).padStart(8),
        r.avgThroughput.toFixed(3).padStart(10),
        speedupStr.padStart(9),
        `${r.validRuns}/${r.totalRuns}`.padStart(6),
        status.padStart(8),
      ].join(' | ');

      console.log(row);
    }
    console.log('-'.repeat(120));
  }

  // Summary analysis
  console.log('\nANALYSIS:');
  for (const [key, group] of groups) {
    const [cmd, model] = key.split('|');
    const baseline = group.find((r) => r.concurrency === 1);
    const c2 = group.find((r) => r.concurrency === 2);
    const c4 = group.find((r) => r.concurrency === 4);

    console.log(`\n  ${cmd} (${model}):`);

    if (!baseline || baseline.validRuns === 0) {
      console.log(`    Baseline (C=1) failed — cannot compute speedup ratios`);
      if (c2 && c2.validRuns > 0 && c4 && c4.validRuns > 0) {
        const speedup = c2.avgElapsedSec / c4.avgElapsedSec;
        console.log(
          `    C=2→C=4: ${speedup.toFixed(2)}x speedup (${c2.avgElapsedSec.toFixed(1)}s → ${c4.avgElapsedSec.toFixed(1)}s)`
        );
      }
      continue;
    }

    if (c2 && c2.validRuns > 0) {
      const speedup2 = baseline.avgElapsedSec / c2.avgElapsedSec;
      const status2 = speedup2 >= 1.3 ? 'PASS' : 'WARN';
      console.log(
        `    C=2: ${speedup2.toFixed(2)}x avg speedup [${status2}] (${baseline.avgElapsedSec.toFixed(1)}s → ${c2.avgElapsedSec.toFixed(1)}s) (target: >1.3x)`
      );
    } else if (c2) {
      console.log(`    C=2: ALL RUNS FAILED`);
    }

    if (c4 && c4.validRuns > 0) {
      const speedup4 = baseline.avgElapsedSec / c4.avgElapsedSec;
      const status4 = speedup4 >= 1.8 ? 'PASS' : 'WARN';
      console.log(
        `    C=4: ${speedup4.toFixed(2)}x avg speedup [${status4}] (${baseline.avgElapsedSec.toFixed(1)}s → ${c4.avgElapsedSec.toFixed(1)}s) (target: >1.8x)`
      );
    } else if (c4) {
      console.log(`    C=4: ALL RUNS FAILED`);
    }
  }
}

function printPerRunDetails(allRuns: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(110));
  console.log('PER-RUN DETAILS');
  console.log('='.repeat(110));

  const header = [
    'Command'.padEnd(12),
    'Model'.padEnd(14),
    'Conc'.padStart(4),
    'Run'.padStart(3),
    'Time(s)'.padStart(8),
    'In'.padStart(4),
    'Out'.padStart(4),
    'In/sec'.padStart(8),
    'Status'.padStart(8),
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(110));

  for (const r of allRuns) {
    const status = r.timedOut
      ? 'TIMEOUT'
      : r.error
        ? 'ERROR'
        : r.outputRecords > 0
          ? 'OK'
          : 'EMPTY';
    const row = [
      r.command.padEnd(12),
      r.model.padEnd(14),
      String(r.concurrency).padStart(4),
      String(r.run).padStart(3),
      r.elapsedSec.toFixed(1).padStart(8),
      String(r.inputRecords).padStart(4),
      String(r.outputRecords).padStart(4),
      r.throughput.toFixed(3).padStart(8),
      status.padStart(8),
    ].join(' | ');
    console.log(row);
  }
  console.log('-'.repeat(110));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const totalExperiments = MODELS.length * CONCURRENCY_LEVELS.length * 2;
  const totalRuns = totalExperiments * RUNS_PER_EXPERIMENT;

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║   Live Concurrency Benchmark                       ║');
  console.log('║   Parallel LLM Throughput Verification              ║');
  console.log('║   Multi-Run Averaging Edition                       ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log(`Config: transform=${TRANSFORM_RECORDS} records, clean=${CLEAN_RECORDS} records`);
  console.log(`Concurrency levels: ${CONCURRENCY_LEVELS.join(', ')}`);
  console.log(`Runs per experiment: ${RUNS_PER_EXPERIMENT}`);
  console.log(
    `Total runs: ${totalRuns} (${totalExperiments} experiments × ${RUNS_PER_EXPERIMENT} runs)`
  );
  console.log(`Timeout: ${CLI_TIMEOUT_MS / 1000}s per run\n`);

  // 1. Check Ollama
  console.log('[1/4] Checking Ollama...');
  if (!(await isOllamaReachable())) {
    console.error('ERROR: Ollama is not reachable at ' + OLLAMA_URL);
    console.error('Start Ollama with: ollama serve');
    process.exit(1);
  }
  console.log('  Ollama is reachable');

  // 2. Pull models
  console.log('\n[2/4] Ensuring models are available...');
  for (const model of MODELS) {
    await pullModelIfNeeded(model);
  }

  // 3. Prepare input data
  console.log('\n[3/4] Preparing benchmark data...');
  const { transformCount, cleanCount } = prepareInputData();

  // 4. Run benchmarks
  console.log('\n[4/4] Running benchmarks...');
  let runIndex = 0;
  const allRuns: BenchmarkResult[] = [];
  const aggregatedResults: AggregatedResult[] = [];

  for (const model of MODELS) {
    console.log(`\n── Model: ${model} ──`);

    for (const concurrency of CONCURRENCY_LEVELS) {
      // Warmup once per concurrency group (not per run)
      await warmupModel(model);

      // ── Transform runs ──
      const transformRuns: BenchmarkResult[] = [];
      for (let run = 1; run <= RUNS_PER_EXPERIMENT; run++) {
        runIndex++;
        console.log(
          `\n  [${runIndex}/${totalRuns}] transform @ c=${concurrency}, run ${run}/${RUNS_PER_EXPERIMENT} (${transformCount} records)`
        );
        try {
          const result = benchTransform(model, concurrency, transformCount, run);
          transformRuns.push(result);
          allRuns.push(result);
          console.log(
            `    → ${result.elapsedSec}s, ${result.outputRecords}/${result.inputRecords} records, ${result.throughput} in/s${result.timedOut ? ' [TIMEOUT]' : ''}`
          );
        } catch (err) {
          console.log(`    → ERROR: ${err}`);
          const errorResult: BenchmarkResult = {
            command: 'transform',
            model,
            concurrency,
            run,
            elapsedSec: 0,
            inputRecords: transformCount,
            outputRecords: 0,
            throughput: 0,
            timedOut: false,
            error: String(err),
          };
          transformRuns.push(errorResult);
          allRuns.push(errorResult);
        }

        if (run < RUNS_PER_EXPERIMENT) await sleep(COOLDOWN_MS);
      }
      aggregatedResults.push(aggregateRuns(transformRuns));

      await sleep(COOLDOWN_MS);

      // ── Clean runs ──
      const cleanRuns: BenchmarkResult[] = [];
      for (let run = 1; run <= RUNS_PER_EXPERIMENT; run++) {
        runIndex++;
        console.log(
          `\n  [${runIndex}/${totalRuns}] clean @ c=${concurrency}, run ${run}/${RUNS_PER_EXPERIMENT} (${cleanCount} records)`
        );
        try {
          const result = benchClean(model, concurrency, cleanCount, run);
          cleanRuns.push(result);
          allRuns.push(result);
          console.log(
            `    → ${result.elapsedSec}s, ${result.outputRecords}/${result.inputRecords} records, ${result.throughput} in/s${result.timedOut ? ' [TIMEOUT]' : ''}`
          );
        } catch (err) {
          console.log(`    → ERROR: ${err}`);
          const errorResult: BenchmarkResult = {
            command: 'clean',
            model,
            concurrency,
            run,
            elapsedSec: 0,
            inputRecords: cleanCount,
            outputRecords: 0,
            throughput: 0,
            timedOut: false,
            error: String(err),
          };
          cleanRuns.push(errorResult);
          allRuns.push(errorResult);
        }

        if (run < RUNS_PER_EXPERIMENT) await sleep(COOLDOWN_MS);
      }
      aggregatedResults.push(aggregateRuns(cleanRuns));

      await sleep(COOLDOWN_MS);
    }
  }

  // Print aggregated summary table
  printAggregatedResults(aggregatedResults);

  // Print per-run detail table
  printPerRunDetails(allRuns);

  // Save all results
  const resultsFile = path.join(BENCH_DIR, 'benchmark_results.json');
  fs.writeFileSync(
    resultsFile,
    JSON.stringify({ aggregated: aggregatedResults, runs: allRuns }, null, 2)
  );
  console.log(`\nResults saved to: ${resultsFile}`);

  // Summary verdict
  const completedRuns = allRuns.filter((r) => !r.timedOut && !r.error && r.outputRecords > 0);
  const timedOutRuns = allRuns.filter((r) => r.timedOut);
  console.log(
    `\nCompleted: ${completedRuns.length}/${allRuns.length} | Timed out: ${timedOutRuns.length}/${allRuns.length}`
  );

  if (completedRuns.length < allRuns.length) {
    console.log('WARNING: Some runs did not complete successfully');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
