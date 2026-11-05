import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Client-only UI state (server state lives in TanStack Query). */
interface UiState {
  siderCollapsed: boolean;
  toggleSider: () => void;
}

export const useUiStore = create<UiState>()(
  persist((set) => ({ siderCollapsed: false, toggleSider: () => set((s) => ({ siderCollapsed: !s.siderCollapsed })) }), {
    name: 'sru-ui',
    // Rehydrated after mount (AdminShell) so SSR markup matches the first client render.
    skipHydration: true,
  }),
);
