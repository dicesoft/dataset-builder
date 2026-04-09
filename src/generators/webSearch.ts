/**
 * Web search module using Ollama's web search API
 * Provides standalone web search functionality with proper API key management
 */

import { getConfig } from '../config';
import { getOllama, type WebSearchResult } from './ollama';

// Re-export WebSearchResult from ollama.ts
export type { WebSearchResult } from './ollama';

export interface WebSearchOptions {
  query: string;
  maxResults?: number;
}

/**
 * Perform web search using Ollama's web search API
 *
 * API Key Priority:
 * 1. OLLAMA_API_KEY environment variable
 * 2. ollamaApiKey config value
 *
 * @param query - Search query string
 * @param maxResults - Maximum results to return (default: 5, max: 10)
 * @returns Array of search results with title, URL, and content
 * @throws Error if API key is missing or request fails
 */
export async function webSearch(query: string, maxResults?: number): Promise<WebSearchResult[]> {
  const config = getConfig();

  // Priority: Environment variable > Config value
  const apiKey = process.env.OLLAMA_API_KEY || config.get('ollamaApiKey');
  if (!apiKey) {
    throw new Error(
      'Ollama API key required. Set OLLAMA_API_KEY env var or run: npm start -- config set ollamaApiKey <key>'
    );
  }

  // Get default max results from config if not specified
  const effectiveMaxResults = maxResults || config.get('webSearchMaxResults') || 5;

  const ollama = getOllama();
  return ollama.webSearch({
    query,
    maxResults: effectiveMaxResults,
  });
}

/**
 * Format search results as context string for LLM prompts
 * @param results - Search results from webSearch()
 * @returns Formatted context string
 */
export function formatSearchResultsAsContext(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const formatted = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join('\n\n');

  return `\n\n--- Web Search Context ---\n\n${formatted}\n\n--- End Context ---\n`;
}

/**
 * Check if web search is available (API key is configured)
 * @returns true if API key is available
 */
export function isWebSearchAvailable(): boolean {
  const config = getConfig();
  return !!(process.env.OLLAMA_API_KEY || config.get('ollamaApiKey'));
}
