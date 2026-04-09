/**
 * Format Compliance Validator
 * Validates that each formatter produces output matching its expected schema.
 * Run via: npx tsx scripts/validate-format-compliance.ts
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { formatDataset } from '../src/formatters/index';
import { listFormatters } from '../src/formatters/registry';

// Sample data for text formatters
const textData = [
  {
    instruction: 'What is machine learning?',
    input: '',
    output: 'Machine learning is a subset of AI that enables systems to learn from data.',
  },
  {
    instruction: 'Explain neural networks',
    input: 'In the context of deep learning',
    output: 'Neural networks are computing systems inspired by biological neural networks.',
  },
  {
    instruction: 'What is NLP?',
    output: 'Natural Language Processing is a field of AI focused on human language.',
  },
];

// Sample data for vision formatters
const visionData = [
  {
    image: 'img/cat.jpg',
    caption: 'A cat sitting on a windowsill',
    class: 'cat',
    bbox: [10, 20, 100, 150],
  },
  {
    image: 'img/dog.jpg',
    caption: 'A dog playing in the park',
    class: 'dog',
    bbox: [50, 30, 200, 250],
  },
];

// Sample data for audio formatters
const audioData = [
  { audio: 'audio/clip1.wav', text: 'Hello world', label: 'speech' },
  { audio: 'audio/clip2.wav', text: 'Good morning', label: 'speech' },
];

// Sample data for HuggingFace formatters
const hfData = [
  { id: 1, text: 'Machine learning is transforming industries.', category: 'tech', score: 0.95 },
  { id: 2, text: 'Climate change requires urgent action.', category: 'science', score: 0.88 },
  { id: 3, text: 'The stock market showed gains today.', category: 'finance', score: 0.72 },
  { id: 4, text: 'New research on quantum computing.', category: 'tech', score: 0.91 },
  { id: 5, text: 'Renewable energy adoption increases.', category: 'science', score: 0.85 },
];

interface ValidatorConfig {
  data: Record<string, unknown>[];
  fieldMap: Record<string, string>;
  validate: (outputDir: string, files: Record<string, string[] | undefined>) => Promise<string[]>;
  extraOptions?: Record<string, unknown>;
}

function getValidatorConfig(formatterName: string): ValidatorConfig | null {
  switch (formatterName) {
    case 'alpaca':
      return {
        data: textData,
        fieldMap: {},
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (typeof item.instruction !== 'string') errors.push('Missing instruction field');
            if (typeof item.output !== 'string') errors.push('Missing output field');
          }
          return errors;
        },
      };

    case 'chatml':
      return {
        data: textData,
        fieldMap: {},
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (!Array.isArray(item.messages)) errors.push('Missing messages array');
            else {
              for (const msg of item.messages) {
                if (!['system', 'user', 'assistant'].includes(msg.role))
                  errors.push(`Invalid role: ${msg.role}`);
                if (typeof msg.content !== 'string') errors.push('Missing content in message');
              }
            }
          }
          return errors;
        },
      };

    case 'sharegpt':
      return {
        data: textData,
        fieldMap: {},
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (!Array.isArray(item.conversations)) errors.push('Missing conversations array');
            else {
              for (const turn of item.conversations) {
                if (!['human', 'gpt', 'system'].includes(turn.from))
                  errors.push(`Invalid from: ${turn.from}`);
                if (typeof turn.value !== 'string') errors.push('Missing value in turn');
              }
            }
          }
          return errors;
        },
      };

    case 'oasst':
      return {
        data: textData,
        fieldMap: {},
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (typeof item.text !== 'string') errors.push('Missing text field');
            if (!['prompter', 'assistant'].includes(item.role))
              errors.push(`Invalid role: ${item.role}`);
            if (typeof item.message_id !== 'string') errors.push('Missing message_id');
          }
          return errors;
        },
      };

    case 'raw':
      return {
        data: textData,
        fieldMap: {},
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (typeof item.prompt !== 'string') errors.push('Missing prompt field');
            if (typeof item.completion !== 'string') errors.push('Missing completion field');
          }
          return errors;
        },
      };

    // Vision formatters - validate structure only (no real image files)
    case 'llava':
      return {
        data: visionData,
        fieldMap: { instruction: '{{caption}}' },
        extraOptions: { imageField: 'image' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (!Array.isArray(item.conversations)) errors.push('Missing conversations array');
            if (typeof item.image !== 'string') errors.push('Missing image field');
          }
          return errors;
        },
      };

    case 'csv-images':
      return {
        data: visionData,
        fieldMap: {},
        extraOptions: { imageField: 'image' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          // csv-images produces a CSV file
          const content = await fs.readFile(trainFiles[0], 'utf-8');
          if (!content.includes('image')) errors.push('CSV missing image column header');
          return errors;
        },
      };

    case 'imagefolder':
      return {
        data: visionData,
        fieldMap: {},
        extraOptions: { imageField: 'image', classField: 'class' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          // ImageFolder produces metadata.csv
          const hasMetadata = trainFiles.some((f) => f.includes('metadata'));
          if (!hasMetadata && trainFiles.length === 0) errors.push('No metadata file produced');
          return errors;
        },
      };

    case 'coco':
      return {
        data: visionData,
        fieldMap: {},
        extraOptions: { imageField: 'image', bboxField: 'bbox', categoryNameField: 'class' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content.images)) errors.push('Missing images array');
          if (!Array.isArray(content.annotations)) errors.push('Missing annotations array');
          if (!Array.isArray(content.categories)) errors.push('Missing categories array');
          return errors;
        },
      };

    case 'yolo':
      return {
        data: visionData,
        fieldMap: {},
        extraOptions: { imageField: 'image', bboxField: 'bbox', classField: 'class' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const allFiles = files.all || files.train || [];
          // YOLO produces label .txt files and classes.txt
          const hasClasses = allFiles.some((f) => f.includes('classes.txt'));
          if (!hasClasses && allFiles.length === 0) errors.push('No classes.txt produced');
          return errors;
        },
      };

    // Audio formatters
    case 'audiofolder':
      return {
        data: audioData,
        fieldMap: {},
        extraOptions: { audioField: 'audio', classField: 'label' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          const hasMetadata = trainFiles.some((f) => f.includes('metadata'));
          if (!hasMetadata && trainFiles.length === 0) errors.push('No metadata file produced');
          return errors;
        },
      };

    case 'speech-text':
      return {
        data: audioData,
        fieldMap: {},
        extraOptions: { audioField: 'audio', textField: 'text' },
        validate: async (outputDir, files) => {
          const errors: string[] = [];
          const trainFiles = files.train || [];
          if (trainFiles.length === 0) {
            errors.push('No train files produced');
            return errors;
          }
          const content = JSON.parse(await fs.readFile(trainFiles[0], 'utf-8'));
          if (!Array.isArray(content)) {
            errors.push('Output is not an array');
            return errors;
          }
          for (const item of content) {
            if (typeof item.audio !== 'string') errors.push('Missing audio field');
            if (typeof item.text !== 'string') errors.push('Missing text field');
          }
          return errors;
        },
      };

    // HuggingFace formatters
    case 'datasetdict':
      return {
        data: hfData,
        fieldMap: {},
        extraOptions: { splitRatios: [0.6, 0.2, 0.2] as [number, number, number] },
        validate: async (outputDir) => {
          const errors: string[] = [];
          try {
            const infoPath = path.join(outputDir, 'dataset_info.json');
            const info = JSON.parse(await fs.readFile(infoPath, 'utf-8'));
            if (!info.features) errors.push('Missing features in dataset_info.json');
            if (!info.splits) errors.push('Missing splits in dataset_info.json');
          } catch {
            errors.push('dataset_info.json not found or invalid');
          }
          // Check split directories exist
          try {
            await fs.access(path.join(outputDir, 'train'));
          } catch {
            errors.push('train/ directory not found');
          }
          return errors;
        },
      };

    case 'parquet':
      return {
        data: hfData,
        fieldMap: {},
        extraOptions: { splitRatios: [0.6, 0.2, 0.2] as [number, number, number] },
        validate: async (outputDir) => {
          const errors: string[] = [];
          try {
            const infoPath = path.join(outputDir, 'dataset_info.json');
            const info = JSON.parse(await fs.readFile(infoPath, 'utf-8'));
            if (!info.features) errors.push('Missing features in dataset_info.json');
          } catch {
            errors.push('dataset_info.json not found or invalid');
          }
          // Check that parquet files exist in split dirs
          try {
            const trainDir = path.join(outputDir, 'train');
            const trainFiles = await fs.readdir(trainDir);
            const hasParquet = trainFiles.some((f) => f.endsWith('.parquet'));
            if (!hasParquet) errors.push('No .parquet file in train/');
          } catch {
            errors.push('train/ directory not found');
          }
          return errors;
        },
      };

    default:
      return null;
  }
}

async function main() {
  const formatters = listFormatters();
  console.log(`\nFormat Compliance Validator`);
  console.log(`=========================`);
  console.log(`Testing ${formatters.length} formatters...\n`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const { name, description } of formatters) {
    const config = getValidatorConfig(name);
    if (!config) {
      console.log(`  SKIP  ${name} - no validator configured`);
      skipped++;
      continue;
    }

    const tmpDir = path.join(os.tmpdir(), `fmt-validate-${name}-${Date.now()}`);
    try {
      const result = await formatDataset({
        inputData: config.data,
        formatter: name,
        outputDir: tmpDir,
        fieldMap: config.fieldMap,
        ...config.extraOptions,
      });

      const errors = await config.validate(tmpDir, result.files);
      if (errors.length === 0) {
        console.log(`  PASS  ${name} - ${description}`);
        passed++;
      } else {
        console.log(`  FAIL  ${name} - ${errors.join('; ')}`);
        failed++;
      }
    } catch (err) {
      console.log(`  FAIL  ${name} - ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    } finally {
      // Cleanup
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  console.log(
    `\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${formatters.length}`
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Validator error:', err);
  process.exit(1);
});
