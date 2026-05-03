import { create } from 'zustand'

interface UiState {
  activeModal: string | null
  activeProjectId: string | null
  openModal: (id: string) => void
  closeModal: () => void
  setActiveProject: (id: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  activeProjectId: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  setActiveProject: (id) => set({ activeProjectId: id }),
}))
