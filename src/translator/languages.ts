/**
 * Language registry for dataset translation
 * Maps language codes to names and tracks model language support
 */

export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
}

export interface ModelLanguageSupport {
  modelId: string;
  provider: string;
  languages: string[];
  notes?: string;
}

export const COMMON_LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Espa\u00f1ol' },
  { code: 'fr', name: 'French', nativeName: 'Fran\u00e7ais' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Portugu\u00eas' },
  { code: 'zh', name: 'Chinese', nativeName: '\u4e2d\u6587' },
  { code: 'ja', name: 'Japanese', nativeName: '\u65e5\u672c\u8a9e' },
  { code: 'ko', name: 'Korean', nativeName: '\ud55c\uad6d\uc5b4' },
  { code: 'ar', name: 'Arabic', nativeName: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
  { code: 'hi', name: 'Hindi', nativeName: '\u0939\u093f\u0928\u094d\u0926\u0940' },
  { code: 'ru', name: 'Russian', nativeName: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'tr', name: 'Turkish', nativeName: 'T\u00fcrk\u00e7e' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Ti\u1ebfng Vi\u1ec7t' },
  { code: 'th', name: 'Thai', nativeName: '\u0e44\u0e17\u0e22' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'nb', name: 'Norwegian', nativeName: 'Norsk' },
  {
    code: 'uk',
    name: 'Ukrainian',
    nativeName: '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430',
  },
  { code: 'cs', name: 'Czech', nativeName: '\u010ce\u0161tina' },
  { code: 'ro', name: 'Romanian', nativeName: 'Rom\u00e2n\u0103' },
  { code: 'el', name: 'Greek', nativeName: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac' },
  { code: 'he', name: 'Hebrew', nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'bn', name: 'Bengali', nativeName: '\u09ac\u09be\u0982\u09b2\u09be' },
];

const ALL_LANGUAGE_CODES = COMMON_LANGUAGES.map((l) => l.code);

export const MODEL_REGISTRY: ModelLanguageSupport[] = [
  {
    modelId: 'gemini-3-flash-preview:cloud',
    provider: 'Google (via Ollama)',
    languages: ALL_LANGUAGE_CODES,
    notes: 'Cloud-routed Gemini model with broad multilingual support',
  },
];

/**
 * Resolve a language input (code, name, or native name) to a LanguageInfo
 */
export function resolveLanguage(input: string): LanguageInfo | null {
  const lower = input.toLowerCase().trim();
  return (
    COMMON_LANGUAGES.find(
      (l) =>
        l.code.toLowerCase() === lower ||
        l.name.toLowerCase() === lower ||
        l.nativeName.toLowerCase() === lower
    ) || null
  );
}

/**
 * Check if a model supports a specific language code
 */
export function isLanguageSupported(modelId: string, code: string): boolean {
  const model = MODEL_REGISTRY.find((m) => m.modelId === modelId);
  if (!model) return true; // Unknown models assumed to support all languages
  return model.languages.includes(code);
}

/**
 * Get all languages supported by a model
 */
export function getModelLanguages(modelId: string): LanguageInfo[] {
  const model = MODEL_REGISTRY.find((m) => m.modelId === modelId);
  if (!model) return COMMON_LANGUAGES;
  return COMMON_LANGUAGES.filter((l) => model.languages.includes(l.code));
}

/**
 * List all supported languages, optionally filtered by model
 */
export function listSupportedLanguages(modelId?: string): LanguageInfo[] {
  if (modelId) return getModelLanguages(modelId);
  return COMMON_LANGUAGES;
}

/**
 * List all registered models with their language support info
 */
export function listRegisteredModels(): ModelLanguageSupport[] {
  return MODEL_REGISTRY;
}
