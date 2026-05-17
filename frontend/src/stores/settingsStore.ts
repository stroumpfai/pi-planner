import { create } from 'zustand'

const SHOW_IDS_KEY = 'pi-planner:show-ids'

interface SettingsState {
  showIds: boolean
  setShowIds: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  showIds: localStorage.getItem(SHOW_IDS_KEY) !== 'false',
  setShowIds: (showIds) => {
    localStorage.setItem(SHOW_IDS_KEY, String(showIds))
    set({ showIds })
  },
}))
