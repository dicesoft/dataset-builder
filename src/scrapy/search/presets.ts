/**
 * Source preset definitions — convenient provider groupings
 */

export interface SourcePreset {
  id: string;
  name: string;
  description: string;
  providers: string[];
}

const presets: SourcePreset[] = [
  {
    id: 'web',
    name: 'Web Search',
    description: 'General web search engines',
    providers: ['google', 'bing', 'brave', 'serpapi-google', 'serpapi-bing', 'serpapi-duckduckgo'],
  },
  {
    id: 'images',
    name: 'Image Search',
    description: 'Image search engines',
    providers: ['google-images', 'bing-images', 'serpapi-google-images'],
  },
  {
    id: 'videos',
    name: 'Video Search',
    description: 'Video platforms',
    providers: ['youtube'],
  },
  {
    id: 'academic',
    name: 'Academic Search',
    description: 'Academic papers and research',
    providers: ['arxiv', 'google-scholar', 'semantic-scholar', 'serpapi-google-scholar'],
  },
  {
    id: 'code',
    name: 'Code Search',
    description: 'Source code and repositories',
    providers: ['github'],
  },
  {
    id: '3d-assets',
    name: '3D Assets',
    description: '3D models and assets',
    providers: ['sketchfab'],
  },
  {
    id: 'social',
    name: 'Social Media',
    description: 'Social media content',
    providers: ['reddit', 'twitter', 'facebook', 'instagram'],
  },
];

const presetMap = new Map(presets.map((p) => [p.id, p]));

export function getPreset(id: string): SourcePreset | undefined {
  return presetMap.get(id);
}

export function listPresets(): SourcePreset[] {
  return [...presets];
}

export function resolvePreset(presetId: string): string[] | undefined {
  return presetMap.get(presetId)?.providers;
}
