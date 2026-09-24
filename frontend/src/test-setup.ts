import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { api } from '@/services/api'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

/**
 * jsdom has no ResizeObserver, and components that measure themselves must not
 * crash for want of one. It never fires: jsdom has no layout to observe, so the
 * one thing a test can control is the initial `getBoundingClientRect`, and a
 * callback that never runs is the honest simulation of a page that never
 * reflows.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub
}

/**
 * Unit tests never reach a server.
 *
 * An unmocked query would otherwise go to jsdom's origin, http://localhost:3000.
 * Where nothing listens there — CI — it is refused and the query simply errors;
 * on a machine running anything on that port it gets a 200 of HTML instead, and
 * a component expecting an array crashes on a string. Rejecting here makes every
 * machine behave like CI, and names the request that slipped through.
 *
 * Guarded because a spec that mocks `@/services/api` wholesale hands this file
 * the mock, which has no defaults to set.
 */
if (api.defaults) {
  api.defaults.adapter = (config) =>
    Promise.reject(
      new Error(`Unmocked request in a unit test: ${config.method?.toUpperCase()} ${config.url}`),
    )
}
