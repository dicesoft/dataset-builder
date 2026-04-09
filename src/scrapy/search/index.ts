/**
 * Search module public API
 */

export type { SearchResult, SearchProvider, SearchProviderConfig, SearchCategory } from './types';
export {
  registerProvider,
  getProvider,
  listProviders,
  searchSingle,
  searchMulti,
  ensureProviders,
} from './registry';
export { deduplicateAndRank, normalizeUrl } from './dedup';
export { listPresets, getPreset, resolvePreset } from './presets';
export type { SourcePreset } from './presets';
export { detectAntiBot, trySelectors, DEFAULT_HEADERS, getRandomUserAgent } from './utils';
export { BaseSearchProvider } from './BaseSearchProvider';
