/**
 * Tests for HuggingFace utility functions
 */

import {
  inferHFSchema,
  featureTypeToHFFeature,
  buildFeaturesMap,
  stratifiedSplit,
  generateDatasetInfo,
  generateYAML,
  featureTypeToParquetType,
  buildParquetRow,
} from './utils';
import type { FeatureType } from '../types';

describe('huggingface/utils', () => {
  describe('inferHFSchema', () => {
    it('should infer string fields', () => {
      const data = [{ name: 'Alice' }, { name: 'Bob' }];
      const schema = inferHFSchema(data);
      expect(schema.name).toBe('string');
    });

    it('should infer number fields as int32 for small integers', () => {
      const data = [{ count: 1 }, { count: 2 }, { count: 3 }];
      const schema = inferHFSchema(data);
      expect(schema.count).toBe('int32');
    });

    it('should infer float types for decimal numbers', () => {
      const data = [{ score: 0.95 }, { score: 0.88 }, { score: 0.72 }];
      const schema = inferHFSchema(data);
      expect(schema.score).toMatch(/^float/);
    });

    it('should infer boolean fields', () => {
      const data = [{ active: true }, { active: false }];
      const schema = inferHFSchema(data);
      expect(schema.active).toBe('bool');
    });

    it('should infer array fields as list type', () => {
      const data = [{ tags: ['ml', 'ai'] }, { tags: ['nlp'] }];
      const schema = inferHFSchema(data);
      expect(schema.tags).toEqual({ type: 'list', feature: 'string' });
    });

    it('should infer object fields as dict type', () => {
      const data = [{ meta: { author: 'Alice', year: 2024 } }];
      const schema = inferHFSchema(data);
      expect(schema.meta).toHaveProperty('type', 'dict');
      const dict = schema.meta as { type: 'dict'; fields: Record<string, FeatureType> };
      expect(dict.fields.author).toBe('string');
    });

    it('should return empty schema for empty data', () => {
      expect(inferHFSchema([])).toEqual({});
    });

    it('should default to string for null-only fields', () => {
      const data = [{ x: null }, { x: undefined }];
      const schema = inferHFSchema(data);
      expect(schema.x).toBe('string');
    });
  });

  describe('featureTypeToHFFeature', () => {
    it('should convert string to Value type', () => {
      const feature = featureTypeToHFFeature('string');
      expect(feature).toEqual({ dtype: 'string', _type: 'Value' });
    });

    it('should convert int32 to Value type', () => {
      const feature = featureTypeToHFFeature('int32');
      expect(feature).toEqual({ dtype: 'int32', _type: 'Value' });
    });

    it('should convert bool to Value type', () => {
      const feature = featureTypeToHFFeature('bool');
      expect(feature).toEqual({ dtype: 'bool', _type: 'Value' });
    });

    it('should convert list to Sequence type', () => {
      const feature = featureTypeToHFFeature({ type: 'list', feature: 'string' });
      expect(feature._type).toBe('Sequence');
      expect(feature.feature).toEqual({ dtype: 'string', _type: 'Value' });
    });

    it('should convert dict fields recursively', () => {
      const ft: FeatureType = {
        type: 'dict',
        fields: { name: 'string', age: 'int32' },
      };
      const feature = featureTypeToHFFeature(ft);
      // Dict is returned as a plain object with HFFeature values
      expect((feature as any).name).toEqual({ dtype: 'string', _type: 'Value' });
      expect((feature as any).age).toEqual({ dtype: 'int32', _type: 'Value' });
    });
  });

  describe('buildFeaturesMap', () => {
    it('should build complete features map from schema', () => {
      const schema: Record<string, FeatureType> = {
        text: 'string',
        id: 'int32',
        score: 'float32',
      };
      const features = buildFeaturesMap(schema);
      expect(features.text).toEqual({ dtype: 'string', _type: 'Value' });
      expect(features.id).toEqual({ dtype: 'int32', _type: 'Value' });
      expect(features.score).toEqual({ dtype: 'float32', _type: 'Value' });
    });
  });

  describe('stratifiedSplit', () => {
    const data = [
      { text: 'a', category: 'tech' },
      { text: 'b', category: 'tech' },
      { text: 'c', category: 'tech' },
      { text: 'd', category: 'tech' },
      { text: 'e', category: 'science' },
      { text: 'f', category: 'science' },
      { text: 'g', category: 'science' },
      { text: 'h', category: 'science' },
      { text: 'i', category: 'finance' },
      { text: 'j', category: 'finance' },
    ];

    it('should split data maintaining class proportions', () => {
      const splits = stratifiedSplit(data, 'category', [0.8, 0.1, 0.1], 42);
      const total = splits.train.length + splits.validation.length + splits.test.length;
      expect(total).toBe(data.length);
      expect(splits.train.length).toBeGreaterThan(0);
    });

    it('should handle single class data', () => {
      const singleClass = data.filter((d) => d.category === 'tech');
      const splits = stratifiedSplit(singleClass, 'category', [0.8, 0.1, 0.1], 42);
      const total = splits.train.length + splits.validation.length + splits.test.length;
      expect(total).toBe(singleClass.length);
    });

    it('should produce deterministic results with same seed', () => {
      const splits1 = stratifiedSplit(data, 'category', [0.8, 0.1, 0.1], 42);
      const splits2 = stratifiedSplit(data, 'category', [0.8, 0.1, 0.1], 42);
      expect(splits1.train).toEqual(splits2.train);
      expect(splits1.validation).toEqual(splits2.validation);
      expect(splits1.test).toEqual(splits2.test);
    });

    it('should throw if ratios do not sum to 1.0', () => {
      expect(() => stratifiedSplit(data, 'category', [0.5, 0.1, 0.1])).toThrow(
        'Split ratios must sum to 1.0'
      );
    });

    it('should handle small classes without errors', () => {
      const smallData = [
        { text: 'a', category: 'rare' },
        { text: 'b', category: 'common' },
        { text: 'c', category: 'common' },
      ];
      const splits = stratifiedSplit(smallData, 'category', [0.8, 0.1, 0.1], 42);
      const total = splits.train.length + splits.validation.length + splits.test.length;
      expect(total).toBe(smallData.length);
    });
  });

  describe('generateDatasetInfo', () => {
    it('should create proper dataset info structure', () => {
      const info = generateDatasetInfo({
        description: 'test dataset',
        features: { text: 'string', id: 'int32' },
        splits: [
          { name: 'train', data: [{ text: 'hello', id: 1 }] },
          { name: 'test', data: [{ text: 'world', id: 2 }] },
        ],
      });

      expect(info.description).toBe('test dataset');
      expect(info.features.text).toEqual({ dtype: 'string', _type: 'Value' });
      expect(info.features.id).toEqual({ dtype: 'int32', _type: 'Value' });
      expect(info.splits).toHaveLength(2);
      expect(info.splits[0].name).toBe('train');
      expect(info.splits[0].num_examples).toBe(1);
      expect(info.download_size).toBeGreaterThan(0);
      expect(info.dataset_size).toBe(info.download_size);
    });
  });

  describe('generateYAML', () => {
    it('should generate YAML with scalar values', () => {
      const yaml = generateYAML({ name: 'test', count: 42, active: true });
      expect(yaml).toContain('name: test');
      expect(yaml).toContain('count: 42');
      expect(yaml).toContain('active: true');
    });

    it('should generate YAML with array values', () => {
      const yaml = generateYAML({ tags: ['ml', 'ai'] });
      expect(yaml).toContain('tags:');
      expect(yaml).toContain('- ml');
      expect(yaml).toContain('- ai');
    });

    it('should generate YAML with nested objects', () => {
      const yaml = generateYAML({ info: { version: '1.0' } });
      expect(yaml).toContain('info:');
      expect(yaml).toContain('version:');
    });

    it('should quote strings with special characters', () => {
      const yaml = generateYAML({ desc: 'has: colon' });
      expect(yaml).toContain('"has: colon"');
    });

    it('should handle empty arrays', () => {
      const yaml = generateYAML({ empty: [] });
      expect(yaml).toContain('empty: []');
    });
  });

  describe('featureTypeToParquetType', () => {
    it('should map string to UTF8', () => {
      expect(featureTypeToParquetType('string')).toBe('UTF8');
    });

    it('should map int32 to INT32', () => {
      expect(featureTypeToParquetType('int32')).toBe('INT32');
    });

    it('should map int64 to INT64', () => {
      expect(featureTypeToParquetType('int64')).toBe('INT64');
    });

    it('should map float32 to FLOAT', () => {
      expect(featureTypeToParquetType('float32')).toBe('FLOAT');
    });

    it('should map float64 to DOUBLE', () => {
      expect(featureTypeToParquetType('float64')).toBe('DOUBLE');
    });

    it('should map bool to BOOLEAN', () => {
      expect(featureTypeToParquetType('bool')).toBe('BOOLEAN');
    });

    it('should map complex types to UTF8', () => {
      expect(featureTypeToParquetType({ type: 'list', feature: 'string' })).toBe('UTF8');
    });
  });

  describe('buildParquetRow', () => {
    it('should convert values according to schema types', () => {
      const schema: Record<string, FeatureType> = {
        name: 'string',
        count: 'int32',
        score: 'float32',
        active: 'bool',
      };
      const record = { name: 'test', count: 42.7, score: 0.95, active: 1 };
      const row = buildParquetRow(record, schema);

      expect(row.name).toBe('test');
      expect(row.count).toBe(42); // floored
      expect(row.score).toBe(0.95);
      expect(row.active).toBe(true);
    });

    it('should serialize complex types as JSON strings', () => {
      const schema: Record<string, FeatureType> = {
        tags: { type: 'list', feature: 'string' },
      };
      const record = { tags: ['a', 'b'] };
      const row = buildParquetRow(record, schema);
      expect(row.tags).toBe('["a","b"]');
    });

    it('should handle missing values with defaults', () => {
      const schema: Record<string, FeatureType> = {
        name: 'string',
        count: 'int32',
      };
      const record = {};
      const row = buildParquetRow(record as any, schema);
      expect(row.name).toBe('');
      expect(row.count).toBe(0);
    });
  });
});
