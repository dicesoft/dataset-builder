/**
 * Default configuration values for the dataset-builder CLI
 */

export interface AppConfig {
  /** Default output directory for generated files */
  outputDir: string;
  /** Default format for exports (json, jsonl, csv) */
  defaultFormat: 'json' | 'jsonl' | 'csv';
  /** Maximum concurrent downloads */
  maxConcurrent: number;
  /** Default scrape limit */
  scrapeLimit: number;
  /** Default Ollama model */
  ollamaModel: string;
  /** Default Ollama vision model (for image analysis) */
  ollamaVisionModel?: string;
  /** Ollama API base URL */
  ollamaUrl: string;
  /** Default LLM filter strictness */
  filterStrictness: 'low' | 'medium' | 'high';
  /** Vision filter sensitivity */
  visionSensitivity: number;
  /** Default batch size for processing */
  batchSize: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** Google Custom Search API key */
  googleApiKey?: string;
  /** Google Custom Search Engine ID */
  googleSearchEngineId?: string;
  /** Bing Web Search API key */
  bingApiKey?: string;
  /** Brave Search API key */
  braveApiKey?: string;
  /** Ollama Web Search API key (ollama.com) - env var: OLLAMA_API_KEY */
  ollamaApiKey?: string;
  /** Maximum web search results to return (default: 5, max: 10) */
  webSearchMaxResults: number;
  /** Default search provider for scrape command (single provider, legacy) */
  searchProvider?: string;
  /** Default search providers (comma-separated, e.g. "google,bing,brave") */
  searchProviders?: string;
  /** GitHub personal access token (optional, for higher rate limits) */
  githubToken?: string;
  /** Semantic Scholar API key (optional, for higher rate limits) */
  semanticScholarApiKey?: string;
  /** Preferred Nitter instance URL for Twitter search (default: auto-rotate) */
  nitterInstance?: string;
  /** YouTube download quality (e.g., 'best', '720', '1080') */
  ytQuality?: string;
  /** YouTube audio-only download mode */
  ytAudioOnly?: boolean;
  /** YouTube video-only download mode (no audio) */
  ytVideoOnly?: boolean;
  /** Path to YouTube cookies.txt file for auth */
  ytCookiesFile?: string;
  /** Max concurrent YouTube downloads (default: 1) */
  ytConcurrent?: number;
  /** Default translation model */
  translateModel?: string;
  /** Records per LLM call for translation (default: 5) */
  translateBatchSize?: number;
  /** Default formatter for format command */
  defaultFormatter?: string;
  /** Default split ratios for format command (e.g., "80:10:10") */
  defaultSplitRatios?: string;
  /** Default random seed for format command */
  defaultSeed?: number;
  /** Default minimum content length for cleanup */
  cleanupMinLength?: number;
  /** Default quality threshold for cleanup (1-10) */
  cleanupQualityThreshold?: number;
  /** Default number of download retries (0 = no retries) */
  retry?: number;
  /** SerpAPI key (serpapi.com) — enables Google, Bing, DuckDuckGo, Scholar, Images */
  serpApiKey?: string;
  /** Location for geo-targeted search results (e.g., "New York,New York,United States") */
  searchLocation?: string;
  /** Concurrent Ollama requests for text LLM tasks (default: 4) */
  ollamaConcurrency: number;
  /** Concurrent Ollama requests for vision tasks (default: 2) */
  ollamaVisionConcurrency: number;
  /** Max models Ollama keeps loaded simultaneously */
  ollamaMaxLoadedModels?: number;
  /** Model to use for relevance scoring / classification (fast model recommended) */
  ollamaClassifyModel?: string;
  /** Model to use for content generation tasks */
  ollamaGenerateModel?: string;
  /** Optional: distribute work across multiple Ollama servers */
  ollamaInstances?: OllamaInstanceConfig[];
}

export interface OllamaInstanceConfig {
  /** Ollama server URL (e.g., "http://gpu-server-2:11434") */
  url: string;
  /** Models this instance serves */
  models?: string[];
  /** Override NUM_PARALLEL for this instance */
  maxParallel?: number;
  /** Load balancing weight (default: 1) */
  weight?: number;
}

export const defaultConfig: AppConfig = {
  outputDir: './output',
  defaultFormat: 'json',
  maxConcurrent: 5,
  scrapeLimit: 10,
  ollamaModel: 'llama3.2',
  ollamaVisionModel: 'llava',
  ollamaUrl: 'http://localhost:11434',
  filterStrictness: 'medium',
  visionSensitivity: 0.5,
  batchSize: 100,
  verbose: false,
  // API Keys (optional - set via config or env vars)
  googleApiKey: undefined,
  googleSearchEngineId: undefined,
  bingApiKey: undefined,
  braveApiKey: undefined,
  ollamaApiKey: undefined,
  // Search provider (auto-detected if not set)
  searchProvider: undefined,
  searchProviders: undefined,
  githubToken: undefined,
  semanticScholarApiKey: undefined,
  nitterInstance: undefined,
  webSearchMaxResults: 5,
  // YouTube download options
  ytQuality: undefined,
  ytAudioOnly: undefined,
  ytVideoOnly: undefined,
  ytCookiesFile: '.temp/www.youtube.com_cookies.txt',
  ytConcurrent: 1,
  // Translation options
  translateModel: 'gemini-3-flash-preview:cloud',
  translateBatchSize: 5,
  // Format options
  defaultFormatter: 'alpaca',
  defaultSplitRatios: '80:10:10',
  defaultSeed: 42,
  cleanupMinLength: 50,
  cleanupQualityThreshold: 7,
  retry: 0,
  serpApiKey: undefined,
  searchLocation: undefined,
  ollamaConcurrency: 4,
  ollamaVisionConcurrency: 2,
  ollamaMaxLoadedModels: undefined,
  ollamaClassifyModel: undefined,
  ollamaGenerateModel: undefined,
  ollamaInstances: undefined,
};

export type AppConfigKey = keyof AppConfig;
