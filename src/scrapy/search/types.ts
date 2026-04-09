/**
 * Search provider type definitions
 */

export type SearchCategory =
  | 'web'
  | 'images'
  | 'video'
  | 'academic'
  | 'code'
  | '3d-assets'
  | 'social';

export interface SearchProviderConfig {
  id: string;
  name: string;
  category: SearchCategory;
  requiresApiKey: boolean;
  apiKeyConfigName?: string;
  hasFallback: boolean;
}

export interface SearchProvider {
  readonly config: SearchProviderConfig;
  isAvailable(): boolean;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  /** Which provider returned this result */
  provider?: string;
  /** Relevance score 0-1 */
  score?: number;
  /** Result type hint */
  category?: string;
  /** Provider-specific extras */
  metadata?: Record<string, unknown>;
}
