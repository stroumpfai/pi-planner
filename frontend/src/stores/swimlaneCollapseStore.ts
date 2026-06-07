import { create } from 'zustand'

const COLLAPSED_KEY = 'pi-planner:swimlane-collapsed'

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveCollapsed(collapsed: Record<string, boolean>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed))
}

function key(piId: string, swimlaneId: string): string {
  return `${piId}:${swimlaneId}`
}

interface SwimlaneCollapseState {
  collapsed: Record<string, boolean>
  isCollapsed: (piId: string, swimlaneId: string) => boolean
  toggle: (piId: string, swimlaneId: string) => void
  setAll: (piId: string, swimlaneIds: string[], collapsed: boolean) => void
}

export const useSwimlaneCollapseStore = create<SwimlaneCollapseState>((set, get) => ({
  collapsed: loadCollapsed(),
  isCollapsed: (piId, swimlaneId) => Boolean(get().collapsed[key(piId, swimlaneId)]),
  toggle: (piId, swimlaneId) => {
    const next = { ...get().collapsed }
    const k = key(piId, swimlaneId)
    if (next[k]) {
      delete next[k]
    } else {
      next[k] = true
    }
    saveCollapsed(next)
    set({ collapsed: next })
  },
  setAll: (piId, swimlaneIds, collapsed) => {
    const next = { ...get().collapsed }
    for (const swimlaneId of swimlaneIds) {
      const k = key(piId, swimlaneId)
      if (collapsed) {
        next[k] = true
      } else {
        delete next[k]
      }
    }
    saveCollapsed(next)
    set({ collapsed: next })
  },
}))
