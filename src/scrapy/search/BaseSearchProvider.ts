/**
 * Abstract base class for search providers
 */

import { getConfig } from '../../config';
import { verboseLog } from '../../utils/logger';
import type { SearchProvider, SearchProviderConfig, SearchResult } from './types';

export abstract class BaseSearchProvider implements SearchProvider {
  abstract readonly config: SearchProviderConfig;

  /**
   * Check if this provider is available (API key present if required)
   */
  isAvailable(): boolean {
    if (!this.config.requiresApiKey) return true;
    if (!this.config.apiKeyConfigName) return false;
    const config = getConfig();
    return !!config.get(this.config.apiKeyConfigName as any);
  }

  /**
   * Get the API key from config
   */
  protected getApiKey(): string | undefined {
    if (!this.config.apiKeyConfigName) return undefined;
    const config = getConfig();
    return config.get(this.config.apiKeyConfigName as any) as string | undefined;
  }

  abstract search(query: string, limit: number): Promise<SearchResult[]>;

  /**
   * Tag results with this provider's id
   */
  protected tagResults(results: SearchResult[]): SearchResult[] {
    return results.map((r) => ({
      ...r,
      provider: r.provider || this.config.id,
      category: r.category || this.config.category,
    }));
  }

  /**
   * Log a verbose message prefixed with the provider name
   */
  protected log(message: string): void {
    verboseLog(`[${this.config.id}] ${message}`);
  }
}
