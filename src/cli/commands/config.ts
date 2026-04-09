/**
 * Config command - Manage application configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig, defaultConfig, AppConfig, AppConfigKey } from '../../config';
import { outputResult, isJsonMode } from '../../utils/output';
import { wrapAction } from '../../utils/commandWrapper';
import { ExitCode, exitWithCode } from '../../utils/exitCodes';
import {
  syncOllamaServer,
  calculateNeededConfig,
  queryLoadedModels,
  autoTuneConcurrency,
} from '../../utils/ollamaServer';

interface ConfigSetOptions {
  global?: boolean;
}

export const configCommand = new Command('config')
  .description('Manage application configuration')
  .argument('[action]', 'Action: get, set, list, reset', 'list')
  .argument('[key]', 'Configuration key')
  .argument('[value]', 'Configuration value')
  .option('-g, --global', 'Use global config', false)
  .action(
    wrapAction(
      'config',
      async (action: string, key?: string, value?: string, options?: ConfigSetOptions) => {
        const config = getConfig();

        switch (action) {
          case 'ollama-sync': {
            const needed = calculateNeededConfig();
            if (!isJsonMode()) {
              console.log(chalk.blue('Syncing Ollama server configuration...'));
              console.log(
                chalk.gray(`  ollamaConcurrency: ${config.get('ollamaConcurrency') ?? 1}`)
              );
              console.log(
                chalk.gray(
                  `  ollamaVisionConcurrency: ${config.get('ollamaVisionConcurrency') ?? 1}`
                )
              );
              console.log(chalk.gray(`  Calculated NUM_PARALLEL: ${needed.numParallel}`));
            }
            await syncOllamaServer();
            if (!isJsonMode()) {
              console.log(chalk.green('Ollama server sync complete'));
            }
            outputResult('config', {
              action: 'ollama-sync',
              success: true,
              concurrency: config.get('ollamaConcurrency') ?? 1,
              visionConcurrency: config.get('ollamaVisionConcurrency') ?? 1,
              numParallel: needed.numParallel,
            });
            break;
          }

          case 'get': {
            if (!key) {
              if (!isJsonMode()) {
                console.error(chalk.red("Error: Key required for 'get' action"));
                console.log(chalk.yellow('Usage: config get <key>'));
              }
              exitWithCode(ExitCode.INVALID_INPUT, "Key required for 'get' action");
            }
            const val = config.get(key as AppConfigKey);
            if (!isJsonMode()) {
              if (val === undefined) {
                console.log(
                  chalk.yellow(`Key '${key}' not set. Default: ${(defaultConfig as any)[key]}`)
                );
              } else {
                console.log(val);
              }
            }
            outputResult('config', {
              action: 'get',
              key,
              value: val ?? (defaultConfig as any)[key] ?? null,
            });
            break;
          }

          case 'set': {
            if (!key || value === undefined) {
              if (!isJsonMode()) {
                console.error(chalk.red("Error: Key and value required for 'set' action"));
                console.log(chalk.yellow('Usage: config set <key> <value>'));
              }
              exitWithCode(ExitCode.INVALID_INPUT, "Key and value required for 'set' action");
            }
            // Parse value based on key type
            const defaultVal = (defaultConfig as any)[key];
            let parsedValue: any = value;

            if (typeof defaultVal === 'number') {
              parsedValue = Number(value);
            } else if (typeof defaultVal === 'boolean') {
              parsedValue = value === 'true';
            }

            config.set(key as AppConfigKey, parsedValue);
            if (!isJsonMode()) {
              console.log(chalk.green(`Set ${key} = ${parsedValue}`));
            }
            outputResult('config', { action: 'set', key, value: parsedValue });
            break;
          }

          case 'show': {
            const needed = calculateNeededConfig();
            if (!isJsonMode()) {
              // Enhanced display with concurrency and model info
              console.log(chalk.bold('\nOllama Parallel Processing:'));
              console.log(`  ${chalk.cyan('NUM_PARALLEL')}: ${chalk.white(needed.numParallel)}`);
              console.log(`  ${chalk.cyan('MAX_QUEUE')}: ${chalk.white(needed.maxQueue)}`);
              if (needed.maxLoadedModels) {
                console.log(
                  `  ${chalk.cyan('MAX_LOADED_MODELS')}: ${chalk.white(needed.maxLoadedModels)}`
                );
              }
              console.log(
                `  ${chalk.cyan('Text concurrency')}: ${chalk.white(config.get('ollamaConcurrency') ?? 4)}`
              );
              console.log(
                `  ${chalk.cyan('Vision concurrency')}: ${chalk.white(config.get('ollamaVisionConcurrency') ?? 2)}`
              );

              // Model routing
              const classifyModel = config.get('ollamaClassifyModel');
              const generateModel = config.get('ollamaGenerateModel');
              if (classifyModel || generateModel) {
                console.log(chalk.bold('\nModel Routing:'));
                console.log(
                  `  ${chalk.cyan('Default')}: ${chalk.white(config.get('ollamaModel') || 'llama3.2')}`
                );
                if (classifyModel)
                  console.log(`  ${chalk.cyan('Classify')}: ${chalk.white(classifyModel)}`);
                if (generateModel)
                  console.log(`  ${chalk.cyan('Generate')}: ${chalk.white(generateModel)}`);
              }

              // Try to show loaded models
              try {
                const loaded = await queryLoadedModels();
                if (loaded.length > 0) {
                  console.log(chalk.bold('\nLoaded Models (ollama ps):'));
                  for (const m of loaded) {
                    console.log(`  ${chalk.cyan(m.name)} - ${chalk.gray(m.size)} (${m.processor})`);
                  }
                }
              } catch {
                // Ollama not running, skip
              }

              // Multi-instance config
              const instances = config.get('ollamaInstances');
              if (instances && instances.length > 0) {
                console.log(chalk.bold('\nOllama Instances:'));
                for (const inst of instances) {
                  console.log(
                    `  ${chalk.cyan(inst.url)} weight=${inst.weight ?? 1} maxParallel=${inst.maxParallel ?? 4}`
                  );
                }
              }

              console.log();
            }
            // Build show data for JSON output
            const showData: Record<string, unknown> = {
              action: 'show',
              numParallel: needed.numParallel,
              maxQueue: needed.maxQueue,
              maxLoadedModels: needed.maxLoadedModels ?? null,
              textConcurrency: config.get('ollamaConcurrency') ?? 4,
              visionConcurrency: config.get('ollamaVisionConcurrency') ?? 2,
              defaultModel: config.get('ollamaModel') || 'llama3.2',
              classifyModel: config.get('ollamaClassifyModel') ?? null,
              generateModel: config.get('ollamaGenerateModel') ?? null,
              instances: config.get('ollamaInstances') ?? [],
            };
            outputResult('config', showData);
            break;
          }

          case 'list': {
            if (!isJsonMode()) {
              console.log(chalk.bold('Current Configuration:\n'));
              // Iterate over all AppConfig keys to show API keys even when unset
              for (const k of Object.keys(defaultConfig) as AppConfigKey[]) {
                const v = config.get(k);
                const defaultVal = (defaultConfig as any)[k];
                const isDefault = v === undefined || v === defaultVal;
                const isUnset = v === undefined && defaultVal === undefined;

                if (isUnset) {
                  // API keys that haven't been set
                  console.log(`  ${chalk.cyan(k)}: ${chalk.gray('(not set)')}`);
                } else {
                  const valueStr = v !== undefined ? JSON.stringify(v) : JSON.stringify(defaultVal);
                  const defaultStr = isDefault ? chalk.gray(' (default)') : '';
                  console.log(`  ${chalk.cyan(k)}: ${chalk.white(valueStr)}${defaultStr}`);
                }
              }
              console.log(chalk.gray(`\nConfig file: ${config.getPath()}`));
            }

            // Build config map for JSON output
            const configMap: Record<string, unknown> = {};
            for (const k2 of Object.keys(defaultConfig) as AppConfigKey[]) {
              configMap[k2] = config.get(k2) ?? (defaultConfig as any)[k2] ?? null;
            }
            outputResult('config', { action: 'list', config: configMap });
            break;
          }

          case 'reset': {
            if (key) {
              config.reset(key as AppConfigKey);
              if (!isJsonMode()) {
                console.log(chalk.green(`Reset '${key}' to default`));
              }
              outputResult('config', { action: 'reset', key, success: true });
            } else {
              config.reset();
              if (!isJsonMode()) {
                console.log(chalk.green('Reset all configuration to defaults'));
              }
              outputResult('config', { action: 'reset', key: null, success: true });
            }
            break;
          }

          default:
            if (!isJsonMode()) {
              console.error(chalk.red(`Unknown action: ${action}`));
              console.log(chalk.yellow('Available actions: get, set, list, reset'));
            }
            exitWithCode(ExitCode.INVALID_INPUT, `Unknown action: ${action}`);
        }
      }
    )
  );

// Add help examples
configCommand.addHelpText(
  'after',
  `
Examples:
  $ config list                     List all configuration
  $ config show                    Show concurrency, models, and VRAM info
  $ config get outputDir           Get output directory
  $ config set outputDir ./data    Set output directory
  $ config set maxConcurrent 10    Set max concurrent downloads
  $ config reset                   Reset all to defaults
  $ config reset outputDir         Reset specific key to default
  $ config ollama-sync             Sync Ollama server with concurrency settings
`
);
