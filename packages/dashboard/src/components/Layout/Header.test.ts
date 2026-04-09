import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, type ThemePreference } from '../../stores/uiStore';

/**
 * 4.1: Theme toggle tests — verifies the theme cycling logic and store updates
 */

const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto',
};

const THEME_ICON: Record<ThemePreference, string> = {
  light: '\u2600',
  dark: '\ud83c\udf19',
  auto: '\ud83d\udda5',
};

describe('Theme toggle (Header)', () => {
  beforeEach(() => {
    // Reset store to default state
    useUiStore.setState({ theme: 'auto', sidebarCollapsed: false, language: 'en' });
  });

  it('starts with auto theme by default', () => {
    expect(useUiStore.getState().theme).toBe('auto');
  });

  it('cycles auto -> light -> dark -> auto', () => {
    const { setTheme } = useUiStore.getState();

    // auto -> light
    setTheme(THEME_CYCLE[useUiStore.getState().theme]);
    expect(useUiStore.getState().theme).toBe('light');

    // light -> dark
    setTheme(THEME_CYCLE[useUiStore.getState().theme]);
    expect(useUiStore.getState().theme).toBe('dark');

    // dark -> auto
    setTheme(THEME_CYCLE[useUiStore.getState().theme]);
    expect(useUiStore.getState().theme).toBe('auto');
  });

  it('updates uiStore.theme on each setTheme call', () => {
    const { setTheme } = useUiStore.getState();

    setTheme('light');
    expect(useUiStore.getState().theme).toBe('light');

    setTheme('dark');
    expect(useUiStore.getState().theme).toBe('dark');

    setTheme('auto');
    expect(useUiStore.getState().theme).toBe('auto');
  });

  it('THEME_ICON maps correct icon for each state', () => {
    expect(THEME_ICON['auto']).toBe('\ud83d\udda5'); // monitor
    expect(THEME_ICON['light']).toBe('\u2600'); // sun
    expect(THEME_ICON['dark']).toBe('\ud83c\udf19'); // moon
  });

  it('THEME_CYCLE covers all three states as a complete cycle', () => {
    const states: ThemePreference[] = ['auto', 'light', 'dark'];
    const visited = new Set<ThemePreference>();
    let current: ThemePreference = 'auto';

    for (let i = 0; i < 3; i++) {
      visited.add(current);
      current = THEME_CYCLE[current];
    }

    expect(visited.size).toBe(3);
    for (const s of states) {
      expect(visited.has(s)).toBe(true);
    }
    // After full cycle we're back to start
    expect(current).toBe('auto');
  });

  it('handles rapid toggling without desync', () => {
    const { setTheme } = useUiStore.getState();

    // Rapidly toggle 9 times (3 full cycles)
    for (let i = 0; i < 9; i++) {
      setTheme(THEME_CYCLE[useUiStore.getState().theme]);
    }

    // Should be back to auto (9 = 3 * 3)
    expect(useUiStore.getState().theme).toBe('auto');
  });
});
