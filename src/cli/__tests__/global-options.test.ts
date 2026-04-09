import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  setGlobalFlags,
  getGlobalFlags,
  isJsonMode,
  isQuietMode,
  isYesMode,
} from '../../utils/output';

describe('Global CLI options', () => {
  beforeEach(() => {
    setGlobalFlags({ json: false, quiet: false, yes: false, verbose: false, dryRun: false });
    delete process.env.JSON_OUTPUT;
    delete process.env.QUIET;
    delete process.env.YES;
    delete process.env.VERBOSE;
    delete process.env.DRY_RUN;
  });

  afterEach(() => {
    delete process.env.JSON_OUTPUT;
    delete process.env.QUIET;
    delete process.env.YES;
    delete process.env.VERBOSE;
    delete process.env.DRY_RUN;
  });

  describe('Commander.js option inheritance with enablePositionalOptions', () => {
    it('global --yes should not conflict with local -y/--yes flag', () => {
      const program = new Command();
      let globalYes: boolean | undefined;
      let localYes: boolean | undefined;

      program
        .enablePositionalOptions()
        .option('--verbose', 'Global verbose')
        .option('--json', 'JSON output')
        .option('--quiet', 'Quiet mode')
        .option('--yes', 'Global yes')
        .hook('preAction', (cmd) => {
          globalYes = cmd.opts().yes;
        });

      const sub = new Command('clean').option('-y, --yes', 'Local yes', false).action((opts) => {
        localYes = opts.yes;
      });

      program.addCommand(sub);

      // When --yes is placed AFTER the subcommand, it goes to the subcommand
      program.parse(['node', 'test', 'clean', '--yes']);
      expect(localYes).toBe(true);
      // Global should not have received it
      expect(globalYes).toBeUndefined();
    });

    it('global --yes placed before subcommand should be captured by parent', () => {
      const program = new Command();
      let globalYes: boolean | undefined;
      let localYes: boolean | undefined;

      program
        .enablePositionalOptions()
        .option('--verbose', 'Global verbose')
        .option('--yes', 'Global yes')
        .hook('preAction', (cmd) => {
          globalYes = cmd.opts().yes;
        });

      const sub = new Command('clean').option('-y, --yes', 'Local yes', false).action((opts) => {
        localYes = opts.yes;
      });

      program.addCommand(sub);

      // When --yes is placed BEFORE the subcommand, it goes to parent
      program.parse(['node', 'test', '--yes', 'clean']);
      expect(globalYes).toBe(true);
      expect(localYes).toBe(false); // default
    });

    it('--json flag should be accessible from preAction hook', () => {
      const program = new Command();
      let jsonFlag: boolean | undefined;

      program
        .enablePositionalOptions()
        .option('--json', 'JSON output')
        .hook('preAction', (cmd) => {
          jsonFlag = cmd.opts().json;
        });

      const sub = new Command('export').action(() => {});
      program.addCommand(sub);

      program.parse(['node', 'test', '--json', 'export']);
      expect(jsonFlag).toBe(true);
    });

    it('--quiet flag should be accessible from preAction hook', () => {
      const program = new Command();
      let quietFlag: boolean | undefined;

      program
        .enablePositionalOptions()
        .option('--quiet', 'Quiet mode')
        .hook('preAction', (cmd) => {
          quietFlag = cmd.opts().quiet;
        });

      const sub = new Command('import').action(() => {});
      program.addCommand(sub);

      program.parse(['node', 'test', '--quiet', 'import']);
      expect(quietFlag).toBe(true);
    });
  });

  describe('env var overrides', () => {
    it('JSON_OUTPUT env var should enable JSON mode', () => {
      process.env.JSON_OUTPUT = 'true';
      expect(isJsonMode()).toBe(true);
    });

    it('DATASET_BUILDER_JSON env var should enable JSON mode', () => {
      process.env.DATASET_BUILDER_JSON = '1';
      expect(isJsonMode()).toBe(true);
    });

    it('QUIET env var should enable quiet mode', () => {
      process.env.QUIET = 'true';
      expect(isQuietMode()).toBe(true);
    });

    it('DATASET_BUILDER_QUIET env var should enable quiet mode', () => {
      process.env.DATASET_BUILDER_QUIET = '1';
      expect(isQuietMode()).toBe(true);
    });

    it('YES env var should enable yes mode', () => {
      process.env.YES = 'true';
      expect(isYesMode()).toBe(true);
    });

    it('CI env var should enable yes mode', () => {
      process.env.CI = 'true';
      expect(isYesMode()).toBe(true);
    });
  });

  describe('setGlobalFlags integration', () => {
    it('preAction hook pattern sets flags correctly', () => {
      const program = new Command();

      program
        .enablePositionalOptions()
        .option('--json', 'JSON')
        .option('--quiet', 'Quiet')
        .option('--yes', 'Yes')
        .option('--verbose', 'Verbose')
        .hook('preAction', (cmd) => {
          const opts = cmd.opts();
          if (opts.json) process.env.JSON_OUTPUT = 'true';
          if (opts.quiet) process.env.QUIET = 'true';
          if (opts.yes) process.env.YES = 'true';
          if (opts.verbose) process.env.VERBOSE = 'true';

          setGlobalFlags({
            json: !!opts.json,
            quiet: !!opts.quiet,
            yes: !!opts.yes,
            verbose: !!opts.verbose,
          });
        });

      const sub = new Command('test-cmd').action(() => {});
      program.addCommand(sub);

      program.parse(['node', 'test', '--json', '--quiet', 'test-cmd']);

      expect(getGlobalFlags().json).toBe(true);
      expect(getGlobalFlags().quiet).toBe(true);
      expect(isJsonMode()).toBe(true);
      expect(isQuietMode()).toBe(true);
    });
  });
});
