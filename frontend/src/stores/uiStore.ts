import { create } from 'zustand'

interface UiState {
  activeModal: string | null
  activeProjectId: string | null
  activePIId: string | null
  openModal: (id: string) => void
  closeModal: () => void
  setActiveProject: (id: string | null) => void
  setActivePI: (id: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  activeProjectId: null,
  activePIId: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  setActiveProject: (id) => set({ activeProjectId: id, activePIId: null }),
  setActivePI: (id) => set({ activePIId: id }),
}))
