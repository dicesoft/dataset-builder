/**
 * Transform templates for converting scraped data to structured records
 */

export { rawExtractTemplate } from './raw-extract';
export { textInstructTemplate } from './text-instruct';
export { textQATemplate } from './text-qa';
export { textConversationTemplate } from './text-conversation';
export { imageClassificationTemplate } from './image-classification';
export { imageCaptioningTemplate } from './image-captioning';
export { visionQATemplate } from './vision-qa';
export { audioClassificationTemplate } from './audio-classification';
export { objectDetectionTemplate } from './object-detection';
export { segmentationTemplate } from './segmentation';

import { TransformTemplate, TransformTemplateType } from '../types';
import { rawExtractTemplate } from './raw-extract';
import { textInstructTemplate } from './text-instruct';
import { textQATemplate } from './text-qa';
import { textConversationTemplate } from './text-conversation';
import { imageClassificationTemplate } from './image-classification';
import { imageCaptioningTemplate } from './image-captioning';
import { visionQATemplate } from './vision-qa';
import { audioClassificationTemplate } from './audio-classification';
import { objectDetectionTemplate } from './object-detection';
import { segmentationTemplate } from './segmentation';

/** All available templates */
export const templates: Map<TransformTemplateType, TransformTemplate> = new Map([
  ['raw-extract', rawExtractTemplate],
  ['text-instruct', textInstructTemplate],
  ['text-qa', textQATemplate],
  ['text-conversation', textConversationTemplate],
  ['image-classification', imageClassificationTemplate],
  ['image-captioning', imageCaptioningTemplate],
  ['vision-qa', visionQATemplate],
  ['audio-classification', audioClassificationTemplate],
  ['object-detection', objectDetectionTemplate],
  ['segmentation', segmentationTemplate],
]);

/** Get template by name */
export function getTemplate(name: TransformTemplateType): TransformTemplate {
  const template = templates.get(name);
  if (!template) {
    throw new Error(
      `Unknown template: ${name}. Available: ${Array.from(templates.keys()).join(', ')}`
    );
  }
  return template;
}

/** List all template names and descriptions */
export function listTemplates(): { name: TransformTemplateType; description: string }[] {
  return Array.from(templates.entries()).map(([name, template]) => ({
    name,
    description: template.description,
  }));
}

/** Check if template requires LLM */
export function templateRequiresLlm(name: TransformTemplateType): boolean {
  const template = templates.get(name);
  return template?.requiresLlm ?? false;
}

/** Check if template uses vision */
export function templateUsesVision(name: TransformTemplateType): boolean {
  const template = templates.get(name);
  return template?.usesVision ?? false;
}

/** Get supported input types for template */
export function getTemplateInputTypes(name: TransformTemplateType): ('text' | 'image' | 'audio')[] {
  const template = templates.get(name);
  return template?.supportedInputs ?? [];
}
