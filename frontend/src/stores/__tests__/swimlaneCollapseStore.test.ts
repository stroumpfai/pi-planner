import { useSwimlaneCollapseStore } from '../swimlaneCollapseStore'

const STORAGE_KEY = 'pi-planner:swimlane-collapsed'

describe('swimlaneCollapseStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSwimlaneCollapseStore.setState({ collapsed: {} })
  })

  it('defaults swimlanes to expanded', () => {
    expect(useSwimlaneCollapseStore.getState().isCollapsed('pi-1', 'sw-1')).toBe(false)
  })

  it('toggle collapses and expands a single swimlane, persisting to localStorage', () => {
    const { toggle, isCollapsed } = useSwimlaneCollapseStore.getState()

    toggle('pi-1', 'sw-1')
    expect(isCollapsed('pi-1', 'sw-1')).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ 'pi-1:sw-1': true })

    toggle('pi-1', 'sw-1')
    expect(useSwimlaneCollapseStore.getState().isCollapsed('pi-1', 'sw-1')).toBe(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({})
  })

  it('keeps collapse state independent across PIs', () => {
    useSwimlaneCollapseStore.getState().toggle('pi-1', 'sw-1')
    expect(useSwimlaneCollapseStore.getState().isCollapsed('pi-1', 'sw-1')).toBe(true)
    expect(useSwimlaneCollapseStore.getState().isCollapsed('pi-2', 'sw-1')).toBe(false)
  })

  it('setAll collapses every given swimlane for a PI', () => {
    useSwimlaneCollapseStore.getState().setAll('pi-1', ['sw-1', 'sw-2', 'sw-3'], true)
    const state = useSwimlaneCollapseStore.getState()
    expect(state.isCollapsed('pi-1', 'sw-1')).toBe(true)
    expect(state.isCollapsed('pi-1', 'sw-2')).toBe(true)
    expect(state.isCollapsed('pi-1', 'sw-3')).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'pi-1:sw-1': true,
      'pi-1:sw-2': true,
      'pi-1:sw-3': true,
    })
  })

  it('setAll expands every given swimlane for a PI, clearing persisted entries', () => {
    useSwimlaneCollapseStore.getState().setAll('pi-1', ['sw-1', 'sw-2'], true)
    useSwimlaneCollapseStore.getState().setAll('pi-1', ['sw-1', 'sw-2'], false)
    const state = useSwimlaneCollapseStore.getState()
    expect(state.isCollapsed('pi-1', 'sw-1')).toBe(false)
    expect(state.isCollapsed('pi-1', 'sw-2')).toBe(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({})
  })

  it('hydrates initial state from localStorage when the store module loads', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'pi-1:sw-1': true }))
    vi.resetModules()
    const { useSwimlaneCollapseStore: freshStore } = await import('../swimlaneCollapseStore')
    expect(freshStore.getState().isCollapsed('pi-1', 'sw-1')).toBe(true)
    expect(freshStore.getState().isCollapsed('pi-1', 'sw-2')).toBe(false)
  })
})
