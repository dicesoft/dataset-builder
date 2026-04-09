/**
 * Unit tests for source presets
 */

import { describe, it, expect } from 'vitest';
import { listPresets, getPreset, resolvePreset } from '../presets';

describe('listPresets', () => {
  it('returns all presets as an array', () => {
    const presets = listPresets();
    expect(Array.isArray(presets)).toBe(true);
    expect(presets.length).toBeGreaterThan(0);
  });

  it('each preset has required fields', () => {
    for (const preset of listPresets()) {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('description');
      expect(preset).toHaveProperty('providers');
      expect(Array.isArray(preset.providers)).toBe(true);
      expect(preset.providers.length).toBeGreaterThan(0);
    }
  });

  it('returns a copy (mutations do not affect internal state)', () => {
    const first = listPresets();
    first.push({ id: 'fake', name: 'Fake', description: 'Fake', providers: [] });
    const second = listPresets();
    expect(second.length).toBe(first.length - 1);
  });

  it('contains expected preset IDs', () => {
    const ids = listPresets().map((p) => p.id);
    expect(ids).toContain('web');
    expect(ids).toContain('images');
    expect(ids).toContain('academic');
    expect(ids).toContain('code');
    expect(ids).toContain('social');
  });
});

describe('getPreset', () => {
  it('finds a preset by ID', () => {
    const preset = getPreset('web');
    expect(preset).toBeDefined();
    expect(preset!.id).toBe('web');
    expect(preset!.name).toBe('Web Search');
    expect(preset!.providers).toContain('google');
  });

  it('returns undefined for unknown preset ID', () => {
    expect(getPreset('nonexistent')).toBeUndefined();
  });

  it('finds the academic preset', () => {
    const preset = getPreset('academic');
    expect(preset).toBeDefined();
    expect(preset!.providers).toContain('arxiv');
  });

  it('finds the code preset', () => {
    const preset = getPreset('code');
    expect(preset).toBeDefined();
    expect(preset!.providers).toContain('github');
  });

  it('finds the social preset', () => {
    const preset = getPreset('social');
    expect(preset).toBeDefined();
    expect(preset!.providers).toContain('reddit');
  });
});

describe('resolvePreset', () => {
  it('returns provider array for valid preset', () => {
    const providers = resolvePreset('web');
    expect(providers).toBeDefined();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers!.length).toBeGreaterThan(0);
    expect(providers).toContain('google');
    expect(providers).toContain('bing');
  });

  it('returns undefined for invalid preset ID', () => {
    expect(resolvePreset('does-not-exist')).toBeUndefined();
  });

  it('resolves images preset to image providers', () => {
    const providers = resolvePreset('images');
    expect(providers).toContain('google-images');
    expect(providers).toContain('bing-images');
  });

  it('resolves academic preset to academic providers', () => {
    const providers = resolvePreset('academic');
    expect(providers).toContain('arxiv');
    expect(providers).toContain('google-scholar');
    expect(providers).toContain('semantic-scholar');
  });
});
