/**
 * Web command - Start the web dashboard server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { wrapAction } from '../../utils/commandWrapper';

export const webCommand = new Command('web')
  .description(
    'Start the dataset-builder web dashboard.\n\n' +
      'Launches a Fastify HTTP server that serves the interactive web dashboard\n' +
      'for managing datasets, running scrape/generate/transform jobs, and\n' +
      'browsing results. The dashboard is accessible in any modern browser.\n\n' +
      'Examples:\n' +
      '  $ dataset-builder web                    # Start on 127.0.0.1:3000\n' +
      '  $ dataset-builder web --port 8080        # Custom port\n' +
      '  $ dataset-builder web --host 0.0.0.0     # Listen on all interfaces\n' +
      '  $ dataset-builder web --open             # Auto-open browser\n' +
      '  $ dataset-builder web --log-level debug  # Verbose server logs'
  )
  .option('-p, --port <port>', 'Port to listen on (default: 3000)', '3000')
  .option(
    '-H, --host <host>',
    'Host/IP to bind to. Use 0.0.0.0 for all interfaces (default: 127.0.0.1)',
    '127.0.0.1'
  )
  .option('-o, --open', 'Automatically open the dashboard in the default browser', false)
  .option(
    '--log-level <level>',
    'Server log level: trace, debug, info, warn, error, fatal (default: info)',
    'info'
  )
  .action(
    wrapAction('web', async (options) => {
      const port = parseInt(options.port, 10);
      const host: string = options.host;
      const logLevel: string = options.logLevel;
      const shouldOpen: boolean = options.open;

      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(chalk.red(`Error: Invalid port "${options.port}". Must be 1-65535.`));
        process.exit(1);
      }

      // Set environment variables before importing the server module
      // so it picks up the configuration
      process.env.HOST = host;
      process.env.PORT = String(port);
      process.env.LOG_LEVEL = logLevel;

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Dataset Builder — Web Dashboard'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();
      console.log(chalk.blue('Starting server...'));
      console.log(chalk.gray(`  Host:      ${host}`));
      console.log(chalk.gray(`  Port:      ${port}`));
      console.log(chalk.gray(`  Log level: ${logLevel}`));
      console.log();

      // Dynamically import the server to avoid loading Fastify at CLI startup
      const { startServer } = await import('../../server/index');
      await startServer();

      const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
      console.log(chalk.green(`\n  Dashboard ready at ${chalk.bold(url)}\n`));

      if (shouldOpen) {
        try {
          const { exec } = await import('child_process');
          const platform = process.platform;
          const cmd =
            platform === 'win32'
              ? `start "" "${url}"`
              : platform === 'darwin'
                ? `open "${url}"`
                : `xdg-open "${url}"`;
          exec(cmd);
        } catch {
          console.log(chalk.yellow('  Could not auto-open browser. Open the URL manually.'));
        }
      }
    })
  );
