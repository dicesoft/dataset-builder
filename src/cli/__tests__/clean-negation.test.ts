import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { cleanCommand } from '../commands/clean';

describe('clean command --no-* negation options', () => {
  function createTestProgram() {
    const program = new Command();
    program.enablePositionalOptions();
    program.addCommand(cleanCommand);
    return program;
  }

  it('should parse --no-trim to set trim=false', async () => {
    let capturedOpts: any;
    const program = new Command();
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--trim', 'Trim whitespace', true)
      .option('--no-trim', 'Disable whitespace trimming')
      .action((opts) => {
        capturedOpts = opts;
      });
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', 'test.json', '--no-trim']);

    expect(capturedOpts.trim).toBe(false);
  });

  it('should parse --no-remove-empty to set removeEmpty=false', async () => {
    let capturedOpts: any;
    const program = new Command();
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--remove-empty', 'Remove empty fields', true)
      .option('--no-remove-empty', 'Keep empty fields')
      .action((opts) => {
        capturedOpts = opts;
      });
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', 'test.json', '--no-remove-empty']);

    expect(capturedOpts.removeEmpty).toBe(false);
  });

  it('should parse --no-normalize-newlines to set normalizeNewlines=false', async () => {
    let capturedOpts: any;
    const program = new Command();
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--normalize-newlines', 'Normalize line endings', true)
      .option('--no-normalize-newlines', 'Keep original line endings')
      .action((opts) => {
        capturedOpts = opts;
      });
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', 'test.json', '--no-normalize-newlines']);

    expect(capturedOpts.normalizeNewlines).toBe(false);
  });

  it('should parse --no-check-nsfw to set checkNsfw=false', async () => {
    let capturedOpts: any;
    const program = new Command();
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--check-nsfw', 'Check for NSFW', true)
      .option('--no-check-nsfw', 'Skip NSFW checking')
      .action((opts) => {
        capturedOpts = opts;
      });
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', 'test.json', '--no-check-nsfw']);

    expect(capturedOpts.checkNsfw).toBe(false);
  });

  it('should default to true for trim, removeEmpty, normalizeNewlines, checkNsfw', async () => {
    let capturedOpts: any;
    const program = new Command();
    const cmd = new Command('clean')
      .requiredOption('-i, --input <path>', 'Input')
      .option('--trim', 'Trim whitespace', true)
      .option('--no-trim', 'Disable whitespace trimming')
      .option('--remove-empty', 'Remove empty fields', true)
      .option('--no-remove-empty', 'Keep empty fields')
      .option('--normalize-newlines', 'Normalize line endings', true)
      .option('--no-normalize-newlines', 'Keep original line endings')
      .option('--check-nsfw', 'Check for NSFW', true)
      .option('--no-check-nsfw', 'Skip NSFW checking')
      .action((opts) => {
        capturedOpts = opts;
      });
    program.addCommand(cmd);
    program.parse(['node', 'test', 'clean', '-i', 'test.json']);

    expect(capturedOpts.trim).toBe(true);
    expect(capturedOpts.removeEmpty).toBe(true);
    expect(capturedOpts.normalizeNewlines).toBe(true);
    expect(capturedOpts.checkNsfw).toBe(true);
  });
});
