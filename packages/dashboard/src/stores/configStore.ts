import { create } from 'zustand';
import { apiGet, apiPatch, apiPost } from '../utils/api';

interface ConfigState {
  config: Record<string, unknown> | null;
  resolvedOutputDir: string | null;
  cwd: string | null;
  loading: boolean;
  error: string | null;
}

interface ConfigActions {
  fetchConfig: () => Promise<void>;
  updateConfig: (patch: Record<string, unknown>) => Promise<void>;
  resetConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState & ConfigActions>()((set) => ({
  config: null,
  resolvedOutputDir: null,
  cwd: null,
  loading: false,
  error: null,

  fetchConfig: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiGet<{
        settings: Record<string, unknown>;
        path: string;
        resolvedOutputDir?: string;
        cwd?: string;
      }>('/api/v1/config');
      set({
        config: data.settings,
        resolvedOutputDir: data.resolvedOutputDir ?? null,
        cwd: data.cwd ?? null,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch config',
        loading: false,
      });
    }
  },

  updateConfig: async (patch) => {
    set({ loading: true, error: null });
    try {
      const data = await apiPatch<{ settings: Record<string, unknown>; updatedKeys: string[] }>(
        '/api/v1/config',
        patch
      );
      set({ config: data.settings, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to update config',
        loading: false,
      });
    }
  },

  resetConfig: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiPost<{ settings: Record<string, unknown>; resetKey: string | null }>(
        '/api/v1/config/reset'
      );
      set({ config: data.settings, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to reset config',
        loading: false,
      });
    }
  },
}));
