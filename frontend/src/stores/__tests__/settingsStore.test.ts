import { useSettingsStore } from '../settingsStore'

const SHOW_PI_EVENTS_KEY = 'pi-planner:show-pi-events'

describe('settingsStore — showPIEvents', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ showPIEvents: true })
  })

  it('defaults to true when localStorage has no value', () => {
    expect(useSettingsStore.getState().showPIEvents).toBe(true)
  })

  it('setShowPIEvents(false) updates state and persists to localStorage', () => {
    useSettingsStore.getState().setShowPIEvents(false)
    expect(useSettingsStore.getState().showPIEvents).toBe(false)
    expect(localStorage.getItem(SHOW_PI_EVENTS_KEY)).toBe('false')
  })

  it('setShowPIEvents(true) updates state and persists to localStorage', () => {
    useSettingsStore.getState().setShowPIEvents(false)
    useSettingsStore.getState().setShowPIEvents(true)
    expect(useSettingsStore.getState().showPIEvents).toBe(true)
    expect(localStorage.getItem(SHOW_PI_EVENTS_KEY)).toBe('true')
  })

  it('reads false from localStorage on module hydration', async () => {
    localStorage.setItem(SHOW_PI_EVENTS_KEY, 'false')
    vi.resetModules()
    const { useSettingsStore: fresh } = await import('../settingsStore')
    expect(fresh.getState().showPIEvents).toBe(false)
  })
})
