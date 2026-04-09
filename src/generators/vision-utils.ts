/**
 * Vision helper utilities for image analysis using Ollama vision models
 */

import ollama from 'ollama';
import { getConfig } from '../config';
import { extractFinalResponse } from './ollama';

/** Classification result from classifyImage */
export interface ClassificationResult {
  label: string;
  relevance: number;
  caption: string;
}

/**
 * Analyze an image with a custom prompt
 * @param imagePath - Path to the image file
 * @param prompt - Custom prompt for analysis
 * @param model - Vision model to use (defaults to config)
 * @returns The model's response text
 */
export async function analyzeImage(
  imagePath: string,
  prompt: string,
  model?: string
): Promise<string> {
  const config = getConfig();
  const visionModel =
    model || config.get('ollamaVisionModel') || config.get('ollamaModel') || 'llava';

  try {
    const response = await ollama.chat({
      model: visionModel,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [imagePath],
        },
      ],
      options: {
        temperature: 0.7,
      } as Parameters<typeof ollama.chat>[0]['options'],
    });

    return extractFinalResponse(response.message?.content || '');
  } catch (error) {
    throw new Error(
      `Image analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Classify an image against a target topic
 * @param imagePath - Path to the image file
 * @param target - Target classification topic (e.g., "car", "animal", "food")
 * @param model - Vision model to use (defaults to config)
 * @returns Classification result with label, relevance score, and caption
 */
export async function classifyImage(
  imagePath: string,
  target: string,
  model?: string
): Promise<ClassificationResult> {
  const config = getConfig();
  const visionModel =
    model || config.get('ollamaVisionModel') || config.get('ollamaModel') || 'llava';

  const prompt = `Analyze this image and classify it regarding "${target}". Return ONLY a JSON object with this exact structure:
{
  "label": "the most specific label describing what's in the image related to ${target}",
  "relevance": 0.0-1.0,
  "caption": "one sentence description of the image"
}

Be strict with relevance - return low scores for images that don't clearly show ${target}.`;

  try {
    const response = await ollama.chat({
      model: visionModel,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [imagePath],
        },
      ],
      options: {
        temperature: 0.3, // Lower temperature for more consistent classification
      } as Parameters<typeof ollama.chat>[0]['options'],
      format: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          relevance: { type: 'number' },
          caption: { type: 'string' },
        },
        required: ['label', 'relevance', 'caption'],
      },
    });

    const content = extractFinalResponse(response.message?.content || '');

    // Parse the JSON response
    try {
      const result = JSON.parse(content) as ClassificationResult;
      return {
        label: result.label || 'unknown',
        relevance: Math.max(0, Math.min(1, result.relevance || 0)),
        caption: result.caption || '',
      };
    } catch {
      // If JSON parsing fails, return a fallback result
      return {
        label: 'unknown',
        relevance: 0,
        caption: content.slice(0, 200),
      };
    }
  } catch (error) {
    throw new Error(
      `Image classification failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate a one-sentence caption for an image
 * @param imagePath - Path to the image file
 * @param model - Vision model to use (defaults to config)
 * @returns A one-sentence caption describing the image
 */
export async function captionImage(imagePath: string, model?: string): Promise<string> {
  const config = getConfig();
  const visionModel =
    model || config.get('ollamaVisionModel') || config.get('ollamaModel') || 'llava';

  const prompt =
    'Describe this image in exactly one sentence. Be concise but descriptive. Do not use bullet points or multiple sentences.';

  try {
    const response = await ollama.chat({
      model: visionModel,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [imagePath],
        },
      ],
      options: {
        temperature: 0.5,
      } as Parameters<typeof ollama.chat>[0]['options'],
    });

    const caption = extractFinalResponse(response.message?.content || '').trim();

    // Ensure it's one sentence - take first sentence if multiple
    const sentences = caption.split(/[.!?]/).filter((s) => s.trim());
    const firstSentence = sentences[0]?.trim();
    if (!firstSentence) return caption;

    // Find which delimiter was used after the first sentence
    const firstSentenceEnd = caption.indexOf(firstSentence) + firstSentence.length;
    const delimiter = caption.charAt(firstSentenceEnd);

    // Use the original delimiter (., !, or ?) or default to period
    const ending = ['.', '!', '?'].includes(delimiter) ? delimiter : '.';
    return firstSentence + ending;
  } catch (error) {
    throw new Error(
      `Image captioning failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
