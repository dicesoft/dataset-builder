/**
 * Ollama API client for LLM text generation
 */

import ollama from 'ollama';
import { getConfig } from '../config';
import { confirm } from '../utils/confirm';
import { readFile } from 'fs/promises';

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface GenerateOptions {
  model?: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: number[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  stop?: string[];
  format?: object; // JSON schema for structured output
  images?: string[]; // Array of file paths to images for vision models
}

/** Chat message for vision/ChatML support */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // File paths to images for vision models
}

/** Chat options */
export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  stream?: boolean;
  format?: object;
  think?: boolean;
}

export interface GenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  thinking?: string;
}

/** Web search result item */
export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

/** Web search options */
export interface WebSearchOptions {
  query: string;
  maxResults?: number;
}

/** Web search API response */
export interface WebSearchResponse {
  results: WebSearchResult[];
}

/** Extract final response, filtering out thinking tokens */
export function extractFinalResponse(text: string): string {
  // Remove content between <thinking>/<think> tags (used by reasoning models like DeepSeek-R1, Qwen)
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
}

/**
 * Error thrown when a requested model is not found locally
 */
export class ModelNotFoundError extends Error {
  constructor(public readonly modelName: string) {
    super(`Model '${modelName}' not found locally`);
    this.name = 'ModelNotFoundError';
  }
}

/**
 * Strip provider prefix from model name (e.g. "ollama:llava" → "llava")
 */
function stripProviderPrefix(model: string): string {
  return model.startsWith('ollama:') ? model.slice(7) : model;
}

export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;
  private apiKey?: string;
  private abortController: AbortController;

  constructor(baseUrl?: string, defaultModel?: string) {
    const config = getConfig();
    this.baseUrl = baseUrl || config.get('ollamaUrl');
    this.defaultModel = defaultModel || config.get('ollamaModel');
    this.apiKey = process.env.OLLAMA_API_KEY || config.get('ollamaApiKey');
    this.abortController = new AbortController();
  }

  /** Abort all in-flight requests */
  abortAll(): void {
    this.abortController.abort();
    this.abortController = new AbortController(); // Reset for future calls
  }

  /** Get the current abort signal (for passing to fetch) */
  private get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Get headers for API requests (includes auth if API key is set) */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /** List available models */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders(),
        signal: this.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { models?: OllamaModel[] };
      return data.models || [];
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }

  /** Check if Ollama is running */
  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a model is available locally, prompting to pull if missing.
   * @param model - Model name to check
   * @param skipConfirmation - If true, auto-pull without prompting
   */
  async ensureModel(model: string, skipConfirmation = false): Promise<void> {
    const normalizedTarget = stripProviderPrefix(model);
    const models = await this.listModels();

    // Normalize comparison: 'llava' matches 'llava:latest'
    const exists = models.some((m) => {
      const name = m.name;
      return (
        name === normalizedTarget ||
        name === `${normalizedTarget}:latest` ||
        name.replace(/:latest$/, '') === normalizedTarget.replace(/:latest$/, '')
      );
    });

    if (exists) return;

    if (!skipConfirmation) {
      const confirmed = await confirm(
        `Model '${normalizedTarget}' not found locally. Pull it now?`,
        true
      );
      if (!confirmed) {
        throw new ModelNotFoundError(normalizedTarget);
      }
    }

    // Pull the model with progress display
    console.log(`Pulling model '${normalizedTarget}'...`);
    const stream = await ollama.pull({ model: normalizedTarget, stream: true });
    let lastStatus = '';
    for await (const progress of stream) {
      const status = progress.status || '';
      if (status !== lastStatus) {
        console.log(`  ${status}`);
        lastStatus = status;
      }
    }
    console.log(`Model '${normalizedTarget}' pulled successfully.`);
  }

  /** Generate text (non-streaming) */
  async generate(options: GenerateOptions): Promise<GenerateResponse> {
    const model = stripProviderPrefix(options.model || this.defaultModel);

    // Handle images if provided - read and base64 encode them
    let images: string[] | undefined;
    if (options.images && options.images.length > 0) {
      images = await Promise.all(
        options.images.map(async (imagePath) => {
          const imageBuffer = await readFile(imagePath);
          return imageBuffer.toString('base64');
        })
      );
    }

    const body: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      system: options.system,
      template: options.template,
      context: options.context,
      stream: false,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p,
      top_k: options.top_k,
      num_predict: options.num_predict,
      stop: options.stop,
    };

    // Add images for vision models
    if (images) {
      body.images = images;
    }

    // Add format for structured output (Ollama native API)
    if (options.format) {
      body.format = options.format;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: this.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('not found')) {
        throw new ModelNotFoundError(model);
      }
      throw new Error(`Ollama error: ${errorText}`);
    }

    const result = (await response.json()) as GenerateResponse;

    // Thinking models (e.g. qwen3.5) may put all content in the `thinking` field
    // with an empty `response`. Fall back to thinking content when response is empty.
    if (!result.response && result.thinking) {
      result.response = result.thinking;
    }

    // Filter thinking tokens from response
    if (result.response) {
      result.response = extractFinalResponse(result.response);
    }

    return result;
  }

  /** Generate text with streaming */
  async *generateStream(options: GenerateOptions): AsyncGenerator<string> {
    const model = stripProviderPrefix(options.model || this.defaultModel);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model,
        prompt: options.prompt,
        system: options.system,
        template: options.template,
        context: options.context,
        stream: true,
        temperature: options.temperature ?? 0.7,
        top_p: options.top_p,
        top_k: options.top_k,
        num_predict: options.num_predict,
        stop: options.stop,
      }),
      signal: this.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('not found')) {
        throw new ModelNotFoundError(model);
      }
      throw new Error(`Ollama error: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as { response?: string; done?: boolean };
            if (data.response) {
              // Filter thinking tokens in streaming mode
              yield extractFinalResponse(data.response);
            }
            if (data.done) break;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Get default model */
  getDefaultModel(): string {
    return this.defaultModel;
  }

  /**
   * Chat with the model using the ollama npm package
   * Supports vision models with images array in messages
   */
  async chat(options: ChatOptions): Promise<string> {
    const model = stripProviderPrefix(options.model || this.defaultModel);

    const chatOptions = {
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p,
      top_k: options.top_k,
      num_predict: options.num_predict,
    };

    // Create an abort promise that rejects when abortAll() is called
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error('Ollama request aborted'));
      if (this.abortController.signal.aborted) {
        onAbort();
        return;
      }
      this.abortController.signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      // Handle streaming and non-streaming separately due to ollama package types
      if (options.stream) {
        // Streaming mode
        const response = await Promise.race([
          ollama.chat({
            model,
            messages: options.messages,
            options: chatOptions,
            format: options.format,
            think: options.think,
            stream: true as const,
          }),
          abortPromise,
        ]);

        // Collect all chunks
        let fullResponse = '';
        for await (const chunk of response) {
          if (this.abortController.signal.aborted) {
            throw new Error('Ollama request aborted');
          }
          if (chunk.message?.content) {
            fullResponse += extractFinalResponse(chunk.message.content);
          }
        }
        return fullResponse;
      } else {
        // Non-streaming mode
        const response = await Promise.race([
          ollama.chat({
            model,
            messages: options.messages,
            options: chatOptions,
            format: options.format,
            think: options.think,
            stream: false as const,
          }),
          abortPromise,
        ]);

        return extractFinalResponse(response.message?.content || '');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        throw new ModelNotFoundError(model);
      }
      throw new Error(`Ollama chat error: ${msg}`);
    }
  }

  /**
   * Perform web search using Ollama's web search API (ollama.com)
   * Requires OLLAMA_API_KEY env var or ollamaApiKey config
   */
  async webSearch(options: WebSearchOptions): Promise<WebSearchResult[]> {
    const config = getConfig();
    const maxResults = options.maxResults || config.get('webSearchMaxResults') || 5;

    // Priority: Environment variable > Config value
    const apiKey = process.env.OLLAMA_API_KEY || config.get('ollamaApiKey');
    if (!apiKey) {
      throw new Error(
        'Ollama API key required. Set OLLAMA_API_KEY env var or run: npm start -- config set ollamaApiKey <key>'
      );
    }

    const response = await fetch('https://ollama.com/api/web_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: options.query,
        max_results: Math.min(maxResults, 10), // Cap at 10 per API limit
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Web search failed: HTTP ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as WebSearchResponse;
    return data.results || [];
  }
}

/** Task types for multi-model routing */
export type LLMTaskType = 'classify' | 'generate' | 'vision' | 'translate';

/**
 * Get the right model for a task type.
 * Reads from config-specific model overrides, falling back to the default ollamaModel.
 */
export function getModelForTask(task: LLMTaskType): string {
  const config = getConfig();
  const defaultModel = config.get('ollamaModel') || 'llama3.2';

  switch (task) {
    case 'classify':
      return config.get('ollamaClassifyModel') || defaultModel;
    case 'generate':
      return config.get('ollamaGenerateModel') || defaultModel;
    case 'vision':
      return config.get('ollamaVisionModel') || defaultModel;
    case 'translate':
      return config.get('translateModel') || defaultModel;
    default:
      return defaultModel;
  }
}

// Singleton instance
let ollamaClient: OllamaClient | null = null;

export function getOllama(baseUrl?: string, defaultModel?: string): OllamaClient {
  if (!ollamaClient) {
    ollamaClient = new OllamaClient(baseUrl, defaultModel);
  }
  return ollamaClient;
}
