import { describe, it, expect } from 'vitest';

describe('translate command comma-separated language parsing', () => {
  it('should flatten comma-separated language values', () => {
    // Simulates what Commander passes for `-l es,fr`
    const optionsLanguages = ['es,fr'];

    const langs = optionsLanguages.flatMap((l: string) =>
      l
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    );

    expect(langs).toEqual(['es', 'fr']);
  });

  it('should handle mixed comma-separated and separate args', () => {
    // Simulates `-l es,fr -l de`
    const optionsLanguages = ['es,fr', 'de'];

    const langs = optionsLanguages.flatMap((l: string) =>
      l
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    );

    expect(langs).toEqual(['es', 'fr', 'de']);
  });

  it('should handle spaces around commas', () => {
    const optionsLanguages = ['es , fr , de'];

    const langs = optionsLanguages.flatMap((l: string) =>
      l
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    );

    expect(langs).toEqual(['es', 'fr', 'de']);
  });

  it('should handle single language without commas', () => {
    const optionsLanguages = ['es'];

    const langs = optionsLanguages.flatMap((l: string) =>
      l
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    );

    expect(langs).toEqual(['es']);
  });

  it('should filter out empty entries from trailing commas', () => {
    const optionsLanguages = ['es,fr,'];

    const langs = optionsLanguages.flatMap((l: string) =>
      l
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    );

    expect(langs).toEqual(['es', 'fr']);
  });
});
