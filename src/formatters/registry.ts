/**
 * Formatter registry - manages all available formatters
 * Plugin-based architecture for extensibility
 */

import type { Formatter, FormatOptions } from './types';

/**
 * Registry of formatters by name
 */
const formatterRegistry = new Map<string, Formatter<FormatOptions>>();

/**
 * Register a formatter
 * @param name - Unique formatter name
 * @param formatter - Formatter implementation
 */
export function registerFormatter<TOptions extends FormatOptions>(
  name: string,
  formatter: Formatter<TOptions>
): void {
  if (formatterRegistry.has(name)) {
    console.warn(`Formatter "${name}" is being redefined`);
  }
  formatterRegistry.set(name, formatter as Formatter<FormatOptions>);
}

/**
 * Get a formatter by name
 * @param name - Formatter name
 * @returns Formatter implementation or undefined if not found
 */
export function getFormatter<TOptions extends FormatOptions>(
  name: string
): Formatter<TOptions> | undefined {
  return formatterRegistry.get(name) as Formatter<TOptions> | undefined;
}

/**
 * Check if a formatter exists
 * @param name - Formatter name
 * @returns True if formatter exists
 */
export function hasFormatter(name: string): boolean {
  return formatterRegistry.has(name);
}

/**
 * Get list of all registered formatters
 * @returns Array of formatter names and descriptions
 */
export function listFormatters(): Array<{ name: string; description: string }> {
  return Array.from(formatterRegistry.entries()).map(([name, formatter]) => ({
    name,
    description: formatter.description,
  }));
}

/**
 * Get formatters by category
 * @returns Grouped formatters
 */
export function getFormattersByCategory(): {
  text: Array<{ name: string; description: string }>;
  vision: Array<{ name: string; description: string }>;
  audio: Array<{ name: string; description: string }>;
  huggingface: Array<{ name: string; description: string }>;
} {
  const all = listFormatters();

  return {
    text: all.filter((f) => ['chatml', 'alpaca', 'sharegpt', 'oasst', 'raw'].includes(f.name)),
    vision: all.filter((f) =>
      ['llava', 'imagefolder', 'csv-images', 'coco', 'yolo', 'coco-seg', 'yolo-seg'].includes(
        f.name
      )
    ),
    audio: all.filter((f) => ['audiofolder', 'speech-text'].includes(f.name)),
    huggingface: all.filter((f) => ['datasetdict', 'parquet'].includes(f.name)),
  };
}

/**
 * Remove a formatter from registry
 * @param name - Formatter name
 * @returns True if formatter was removed
 */
export function unregisterFormatter(name: string): boolean {
  return formatterRegistry.delete(name);
}

/**
 * Clear all registered formatters
 */
export function clearRegistry(): void {
  formatterRegistry.clear();
}

/**
 * Get the total number of registered formatters
 */
export function getFormatterCount(): number {
  return formatterRegistry.size;
}
