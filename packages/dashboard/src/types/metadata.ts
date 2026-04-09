/**
 * Shared types for the metadata store and API responses.
 */

/** A single format entry from /api/v1/formats */
export interface FormatInfo {
  name: string;
  description: string;
}

/** Formats grouped by category from /api/v1/formats */
export type FormatsByCategory = Record<string, FormatInfo[]>;

/** A transform template from /api/v1/templates */
export interface TemplateMeta {
  name: string;
  description: string;
  requiresLlm: boolean;
  usesVision: boolean;
  supportedInputs: string[];
}

/** A supported translation language from /api/v1/languages */
export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

/** An Ollama model from /api/v1/models */
export interface OllamaModel {
  name: string;
  size: number;
  modifiedAt: string;
  details: Record<string, unknown> | null;
}

/** Option metadata from /api/v1/commands */
export interface CommandOptionMeta {
  name: string;
  flags: string;
  description: string;
  required: boolean;
  type: 'string' | 'boolean' | 'number' | 'unknown';
  defaultValue: unknown;
  choices: string[] | null;
}

/** Command metadata from /api/v1/commands */
export interface CommandMeta {
  name: string;
  description: string;
  options: CommandOptionMeta[];
  dependencies: string[];
}

/** A search provider from /api/v1/providers */
export interface ProviderInfo {
  name: string;
  available: boolean;
  requiresKey: string | null;
}

/** Aggregated enum values from /api/v1/metadata/enums */
export interface MetadataEnums {
  outputFormats: string[];
  downloadFormats: string[];
  generateTypes: string[];
  strictnessLevels: string[];
  videoCodecs: string[];
  videoFormats: string[];
  validateMethods: string[];
  sourcePresets: string[];
}

/** State shape for the metadata store */
export interface MetadataState {
  formats: FormatInfo[];
  formatsByCategory: FormatsByCategory;
  templates: TemplateMeta[];
  languages: Language[];
  models: OllamaModel[];
  modelsAvailable: boolean;
  commandMetas: Map<string, CommandMeta>;
  providers: ProviderInfo[];
  enums: MetadataEnums | null;
  loading: boolean;
  error: string | null;
}

/** Actions for the metadata store */
export interface MetadataActions {
  fetchAll: () => Promise<void>;
}
