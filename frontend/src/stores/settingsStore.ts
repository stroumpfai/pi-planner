import { create } from 'zustand'

const SHOW_IDS_KEY = 'pi-planner:show-ids'
const SHOW_EFFORT_UNIT_KEY = 'pi-planner:show-effort-unit'
const FEATURE_COL_WIDTH_KEY = 'pi-planner:feature-col-width'
const SHOW_FEATURE_NAME_IN_CARD_KEY = 'pi-planner:show-feature-name-in-card'
const DEFAULT_COL_WIDTH = 192

interface SettingsState {
  showIds: boolean
  setShowIds: (v: boolean) => void
  showEffortUnit: boolean
  setShowEffortUnit: (v: boolean) => void
  featureColumnWidth: number
  setFeatureColumnWidth: (v: number) => void
  showFeatureNameInCard: boolean
  setShowFeatureNameInCard: (v: boolean) => void
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
  featureColumnWidth: Number(localStorage.getItem(FEATURE_COL_WIDTH_KEY)) || DEFAULT_COL_WIDTH,
  setFeatureColumnWidth: (featureColumnWidth) => {
    localStorage.setItem(FEATURE_COL_WIDTH_KEY, String(featureColumnWidth))
    set({ featureColumnWidth })
  },
  showFeatureNameInCard: localStorage.getItem(SHOW_FEATURE_NAME_IN_CARD_KEY) === 'true',
  setShowFeatureNameInCard: (showFeatureNameInCard) => {
    localStorage.setItem(SHOW_FEATURE_NAME_IN_CARD_KEY, String(showFeatureNameInCard))
    set({ showFeatureNameInCard })
  },
}))
