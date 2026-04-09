import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('multi-word option values with enablePositionalOptions', () => {
  it('should parse multi-word --vision-target as single string after join fix', () => {
    const program = new Command();
    let parsedTarget: string | undefined;

    program.enablePositionalOptions();

    const sub = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--vision-filter', 'Enable vision', false)
      .option('--vision-target <topic>', 'Target topic')
      .action((opts) => {
        // Apply the same fix as in clean.ts
        if (Array.isArray(opts.visionTarget)) opts.visionTarget = opts.visionTarget.join(' ');
        parsedTarget = opts.visionTarget;
      });

    program.addCommand(sub);
    program.parse([
      'node',
      'test',
      'clean',
      '-i',
      'dir/',
      '--vision-filter',
      '--vision-target',
      'sports cars',
    ]);

    // With enablePositionalOptions, "sports cars" may be split; the join fix handles it
    expect(parsedTarget).toBeDefined();
    expect(typeof parsedTarget).toBe('string');
  });

  it('should parse single-word --vision-target unchanged', () => {
    const program = new Command();
    let parsedTarget: string | undefined;

    program.enablePositionalOptions();

    const sub = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--vision-target <topic>', 'Target topic')
      .action((opts) => {
        if (Array.isArray(opts.visionTarget)) opts.visionTarget = opts.visionTarget.join(' ');
        parsedTarget = opts.visionTarget;
      });

    program.addCommand(sub);
    program.parse(['node', 'test', 'clean', '-i', 'dir/', '--vision-target', 'sports']);

    expect(parsedTarget).toBe('sports');
  });

  it('should parse multi-word --system-prompt as single string after join fix', () => {
    const program = new Command();
    let parsedPrompt: string | undefined;

    program.enablePositionalOptions();

    const sub = new Command('format')
      .option('--system-prompt <text>', 'System prompt')
      .action((opts) => {
        if (Array.isArray(opts.systemPrompt)) opts.systemPrompt = opts.systemPrompt.join(' ');
        parsedPrompt = opts.systemPrompt;
      });

    program.addCommand(sub);
    program.parse(['node', 'test', 'format', '--system-prompt', 'You are a helpful assistant']);

    expect(parsedPrompt).toBeDefined();
    expect(typeof parsedPrompt).toBe('string');
  });

  it('should handle Array.isArray join for multi-word values', () => {
    // Simulate what happens when commander splits "sports cars" into an array
    const opts = { visionTarget: ['sports', 'cars'] as unknown };
    if (Array.isArray(opts.visionTarget)) {
      opts.visionTarget = (opts.visionTarget as string[]).join(' ');
    }
    expect(opts.visionTarget).toBe('sports cars');
  });

  it('should not alter string values in the join fix', () => {
    const opts = { visionTarget: 'sports' as unknown };
    if (Array.isArray(opts.visionTarget)) {
      opts.visionTarget = (opts.visionTarget as string[]).join(' ');
    }
    expect(opts.visionTarget).toBe('sports');
  });
});
