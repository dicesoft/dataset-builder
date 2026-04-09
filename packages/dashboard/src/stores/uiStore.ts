import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'auto';

interface UiState {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  language: string;
}

interface UiActions {
  setTheme: (theme: ThemePreference) => void;
  toggleSidebar: () => void;
  setLanguage: (language: string) => void;
}

export const useUiStore = create<UiState & UiActions>()(
  persist(
    (set) => ({
      theme: 'auto',
      sidebarCollapsed: false,
      language: 'en',

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'dataset-builder-ui',
    }
  )
);
