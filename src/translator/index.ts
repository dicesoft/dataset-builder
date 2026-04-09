/**
 * Dataset translation module
 * Translates text datasets into multiple languages using LLM
 */

export {
  COMMON_LANGUAGES,
  MODEL_REGISTRY,
  resolveLanguage,
  isLanguageSupported,
  getModelLanguages,
  listSupportedLanguages,
  listRegisteredModels,
} from './languages';
export type { LanguageInfo, ModelLanguageSupport } from './languages';

export { translateDataset, buildSchemaFromRecords, setAbortFlag, isAborted } from './engine';
export type { TranslateOptions, TranslationProgress, TranslationResult } from './engine';

export {
  createTranslationTUI,
  updateTranslationProgress,
  stopTranslationTUI,
  setTranslationAborting,
  isTranslationTUIActive,
  printTranslationSummary,
} from './tui';
