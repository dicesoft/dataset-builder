import { create } from 'zustand';
import { apiGet } from '../utils/api';
import type {
  FormatInfo,
  FormatsByCategory,
  TemplateMeta,
  Language,
  OllamaModel,
  CommandMeta,
  ProviderInfo,
  MetadataEnums,
  MetadataState,
  MetadataActions,
} from '../types/metadata';

/** Response shape from GET /api/v1/formats */
interface FormatsResponse {
  formats: FormatInfo[];
  byCategory: FormatsByCategory;
  count: number;
}

/** Response shape from GET /api/v1/templates */
interface TemplatesResponse {
  templates: TemplateMeta[];
  count: number;
}

/** Response shape from GET /api/v1/languages */
interface LanguagesResponse {
  languages: Language[];
  count: number;
}

/** Response shape from GET /api/v1/models */
interface ModelsResponse {
  models: OllamaModel[];
  available: boolean;
  count?: number;
  error?: string;
}

/** Response shape from GET /api/v1/commands */
interface CommandsResponse {
  commands: CommandMeta[];
}

/** Response shape from GET /api/v1/providers */
interface ProvidersResponse {
  providers: ProviderInfo[];
}

/** Response shape from GET /api/v1/metadata/enums */
type EnumsResponse = MetadataEnums;

export const useMetadataStore = create<MetadataState & MetadataActions>()((set) => ({
  formats: [],
  formatsByCategory: {},
  templates: [],
  languages: [],
  models: [],
  modelsAvailable: false,
  commandMetas: new Map(),
  providers: [],
  enums: null,
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [
        formatsRes,
        templatesRes,
        languagesRes,
        modelsRes,
        commandsRes,
        providersRes,
        enumsRes,
      ] = await Promise.all([
        apiGet<FormatsResponse>('/api/v1/formats'),
        apiGet<TemplatesResponse>('/api/v1/templates'),
        apiGet<LanguagesResponse>('/api/v1/languages'),
        apiGet<ModelsResponse>('/api/v1/models'),
        apiGet<CommandsResponse>('/api/v1/commands'),
        apiGet<ProvidersResponse>('/api/v1/providers'),
        apiGet<EnumsResponse>('/api/v1/metadata/enums'),
      ]);

      const commandMetas = new Map<string, CommandMeta>(
        commandsRes.commands.map((cmd) => [cmd.name, cmd])
      );

      set({
        formats: formatsRes.formats,
        formatsByCategory: formatsRes.byCategory,
        templates: templatesRes.templates,
        languages: languagesRes.languages,
        models: modelsRes.models,
        modelsAvailable: modelsRes.available,
        commandMetas,
        providers: providersRes.providers,
        enums: enumsRes,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch metadata',
        loading: false,
      });
    }
  },
}));
