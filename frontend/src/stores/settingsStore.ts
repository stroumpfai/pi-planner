import { create } from 'zustand'

const SHOW_IDS_KEY = 'pi-planner:show-ids'
const SHOW_EFFORT_UNIT_KEY = 'pi-planner:show-effort-unit'

interface SettingsState {
  showIds: boolean
  setShowIds: (v: boolean) => void
  showEffortUnit: boolean
  setShowEffortUnit: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  showIds: localStorage.getItem(SHOW_IDS_KEY) !== 'false',
  setShowIds: (showIds) => {
    localStorage.setItem(SHOW_IDS_KEY, String(showIds))
    set({ showIds })
  },
  showEffortUnit: localStorage.getItem(SHOW_EFFORT_UNIT_KEY) !== 'false',
  setShowEffortUnit: (showEffortUnit) => {
    localStorage.setItem(SHOW_EFFORT_UNIT_KEY, String(showEffortUnit))
    set({ showEffortUnit })
  },
}))
