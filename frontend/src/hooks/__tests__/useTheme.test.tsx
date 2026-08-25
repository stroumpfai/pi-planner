import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTheme } from '../useTheme'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * A controllable stand-in for the media query list. The global stub in
 * `test-setup.ts` records listeners but never fires them, and the `system`
 * branch of useTheme is entirely about reacting to that event, so this spec
 * swaps in a fake it can drive.
 */
function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.add(fn)
    }),
    removeEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.delete(fn)
    }),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return {
    mql,
    /** Fire an OS-level colour scheme change at whatever useTheme registered. */
    emit(matches: boolean) {
      mql.matches = matches
      act(() => {
        listeners.forEach((fn) => fn({ matches } as MediaQueryListEvent))
      })
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

const root = () => document.documentElement

beforeEach(() => {
  root().classList.remove('dark')
  useSettingsStore.setState({ colorScheme: 'system' })
})

afterEach(() => {
  vi.restoreAllMocks()
  root().classList.remove('dark')
})

describe('useTheme', () => {
  it('adds the dark class when the scheme is dark', () => {
    useSettingsStore.setState({ colorScheme: 'dark' })

    renderHook(() => useTheme())

    expect(root().classList.contains('dark')).toBe(true)
  })

  it('removes the dark class when the scheme is light', () => {
    root().classList.add('dark')
    useSettingsStore.setState({ colorScheme: 'light' })

    renderHook(() => useTheme())

    expect(root().classList.contains('dark')).toBe(false)
  })

  it('follows the OS preference when the scheme is system', () => {
    installMatchMedia(true)
    useSettingsStore.setState({ colorScheme: 'system' })

    renderHook(() => useTheme())

    expect(root().classList.contains('dark')).toBe(true)
  })

  it('re-applies the class when the OS preference changes', () => {
    const media = installMatchMedia(false)
    useSettingsStore.setState({ colorScheme: 'system' })

    renderHook(() => useTheme())
    expect(root().classList.contains('dark')).toBe(false)

    media.emit(true)
    expect(root().classList.contains('dark')).toBe(true)

    media.emit(false)
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('does not follow the OS preference once an explicit scheme is chosen', () => {
    const media = installMatchMedia(false)
    useSettingsStore.setState({ colorScheme: 'dark' })

    renderHook(() => useTheme())

    // The system branch never ran, so nothing is listening and an OS flip to
    // light must not undo the explicit dark choice.
    expect(media.listenerCount).toBe(0)
    expect(root().classList.contains('dark')).toBe(true)
  })

  it('unsubscribes from the media query on unmount', () => {
    const media = installMatchMedia(true)
    useSettingsStore.setState({ colorScheme: 'system' })

    const { unmount } = renderHook(() => useTheme())
    expect(media.listenerCount).toBe(1)

    unmount()

    expect(media.listenerCount).toBe(0)
    expect(media.mql.removeEventListener).toHaveBeenCalled()
  })

  it('unsubscribes when switching away from system', () => {
    const media = installMatchMedia(true)
    useSettingsStore.setState({ colorScheme: 'system' })

    const { rerender } = renderHook(() => useTheme())
    expect(media.listenerCount).toBe(1)

    act(() => {
      useSettingsStore.setState({ colorScheme: 'light' })
    })
    rerender()

    expect(media.listenerCount).toBe(0)
    expect(root().classList.contains('dark')).toBe(false)
  })
})
