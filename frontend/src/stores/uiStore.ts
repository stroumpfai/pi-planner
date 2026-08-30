import { create } from 'zustand'

interface UiState {
  activeModal: string | null
  activeProjectId: string | null
  activePIId: string | null
  activeTeamId: string | null
  openModal: (id: string) => void
  closeModal: () => void
  setActiveProject: (id: string | null) => void
  setActivePI: (id: string | null) => void
  setActiveTeam: (id: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  activeProjectId: null,
  activePIId: null,
  activeTeamId: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  // A project and a team are mutually exclusive views, the same way a PI belongs
  // to exactly one project: opening one closes the other rather than leaving a
  // stale id behind for a later branch to read.
  setActiveProject: (id) => set({ activeProjectId: id, activePIId: null, activeTeamId: null }),
  setActivePI: (id) => set({ activePIId: id }),
  setActiveTeam: (id) => set({ activeTeamId: id, activeProjectId: null, activePIId: null }),
}))
