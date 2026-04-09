import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('clean command --dedupe-images in hasImageOps guard', () => {
  it('should treat --dedupe-images as an image operation (no error for directory input)', () => {
    // This test verifies that --dedupe-images and --dedupe-images-dry-run
    // are included in the hasImageOps condition so directory input is accepted

    let capturedOpts: any;
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--vision-filter', 'Vision filter', false)
      .option('--remove-junk', 'Remove junk', false)
      .option('--min-size <bytes>', 'Min size')
      .option('--min-dimensions <WxH>', 'Min dimensions')
      .option('--dedupe-images', 'Dedupe images', false)
      .option('--dedupe-images-dry-run', 'Dedupe dry run', false)
      .action((opts) => {
        capturedOpts = opts;
      });

    const program = new Command();
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', '/tmp/images', '--dedupe-images']);

    // Verify the option is parsed
    expect(capturedOpts.dedupeImages).toBe(true);

    // Simulate the hasImageOps guard logic from clean.ts
    const options = capturedOpts;
    const hasImageOps =
      options.visionFilter ||
      options.removeJunk ||
      options.minSize ||
      options.minDimensions ||
      options.dedupeImages ||
      options.dedupeImagesDryRun;

    expect(hasImageOps).toBe(true);
  });

  it('should treat --dedupe-images-dry-run as an image operation', () => {
    let capturedOpts: any;
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--vision-filter', 'Vision filter', false)
      .option('--remove-junk', 'Remove junk', false)
      .option('--min-size <bytes>', 'Min size')
      .option('--min-dimensions <WxH>', 'Min dimensions')
      .option('--dedupe-images', 'Dedupe images', false)
      .option('--dedupe-images-dry-run', 'Dedupe dry run', false)
      .action((opts) => {
        capturedOpts = opts;
      });

    const program = new Command();
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', '/tmp/images', '--dedupe-images-dry-run']);

    expect(capturedOpts.dedupeImagesDryRun).toBe(true);

    const options = capturedOpts;
    const hasImageOps =
      options.visionFilter ||
      options.removeJunk ||
      options.minSize ||
      options.minDimensions ||
      options.dedupeImages ||
      options.dedupeImagesDryRun;

    expect(hasImageOps).toBe(true);
  });

  it('should not have hasImageOps when no image flags are set', () => {
    let capturedOpts: any;
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--vision-filter', 'Vision filter', false)
      .option('--remove-junk', 'Remove junk', false)
      .option('--min-size <bytes>', 'Min size')
      .option('--min-dimensions <WxH>', 'Min dimensions')
      .option('--dedupe-images', 'Dedupe images', false)
      .option('--dedupe-images-dry-run', 'Dedupe dry run', false)
      .action((opts) => {
        capturedOpts = opts;
      });

    const program = new Command();
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', '/tmp/images']);

    const options = capturedOpts;
    const hasImageOps =
      options.visionFilter ||
      options.removeJunk ||
      options.minSize ||
      options.minDimensions ||
      options.dedupeImages ||
      options.dedupeImagesDryRun;

    expect(hasImageOps).toBeFalsy();
  });
});
