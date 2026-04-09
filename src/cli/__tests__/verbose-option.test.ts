import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('--verbose option with enablePositionalOptions', () => {
  it('should pass --verbose to subcommand when placed after subcommand name', () => {
    const program = new Command();
    let parentVerbose: boolean | undefined;
    let childVerbose: boolean | undefined;

    program
      .enablePositionalOptions()
      .option('--verbose', 'Global verbose')
      .hook('preAction', (cmd) => {
        parentVerbose = cmd.opts().verbose;
      });

    const sub = new Command('clean').option('--verbose', 'Child verbose', false).action((opts) => {
      childVerbose = opts.verbose;
    });

    program.addCommand(sub);
    program.parse(['node', 'test', 'clean', '--verbose']);

    expect(childVerbose).toBe(true);
    expect(parentVerbose).toBeUndefined();
  });

  it('should pass --verbose to parent when placed before subcommand name', () => {
    const program = new Command();
    let parentVerbose: boolean | undefined;
    let childVerbose: boolean | undefined;

    program
      .enablePositionalOptions()
      .option('--verbose', 'Global verbose')
      .hook('preAction', (cmd) => {
        parentVerbose = cmd.opts().verbose;
      });

    const sub = new Command('clean').option('--verbose', 'Child verbose', false).action((opts) => {
      childVerbose = opts.verbose;
    });

    program.addCommand(sub);
    program.parse(['node', 'test', '--verbose', 'clean']);

    expect(parentVerbose).toBe(true);
    expect(childVerbose).toBe(false);
  });
});
