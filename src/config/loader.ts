/**
 * Configuration file loader/saver
 */

import Conf from 'conf';
import { AppConfig, defaultConfig, AppConfigKey } from './defaults';

const STORE_NAME = 'dataset-builder';

export class ConfigLoader {
  private store: Conf<AppConfig>;

  constructor() {
    this.store = new Conf<AppConfig>({
      projectName: STORE_NAME,
      defaults: defaultConfig,
      fileExtension: 'json',
    });
  }

  /** Get all configuration */
  getAll(): AppConfig {
    return this.store.store;
  }

  /** Get a specific config value */
  get<K extends AppConfigKey>(key: K): AppConfig[K] {
    return this.store.get(key);
  }

  /** Set a config value */
  set<K extends AppConfigKey>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  /** Set multiple config values */
  setMany(values: Partial<AppConfig>): void {
    for (const [key, value] of Object.entries(values)) {
      if (key in defaultConfig) {
        this.store.set(key as AppConfigKey, value);
      }
    }
  }

  /** Reset a config value to default */
  reset(key?: AppConfigKey): void {
    if (key) {
      this.store.delete(key);
    } else {
      this.store.clear();
    }
  }

  /** Get config file path */
  getPath(): string {
    return this.store.path;
  }

  /** Check if a key exists */
  has(key: AppConfigKey): boolean {
    return this.store.has(key);
  }
}

// Singleton instance
let configInstance: ConfigLoader | null = null;

export function getConfig(): ConfigLoader {
  if (!configInstance) {
    configInstance = new ConfigLoader();
  }
  return configInstance;
}
