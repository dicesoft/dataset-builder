/**
 * Configuration module for dataset-builder
 * Provides a centralized configuration system for all CLI commands
 */

export { AppConfig, AppConfigKey, defaultConfig, OllamaInstanceConfig } from './defaults';
export { ConfigLoader, getConfig } from './loader';
