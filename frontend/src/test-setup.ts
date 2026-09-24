import '@testing-library/jest-dom'
import { afterEach, beforeEach, vi } from 'vitest'
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
 * Unit tests never reach a server, and a test that tries fails.
 *
 * An unmocked query would otherwise go to jsdom's origin, http://localhost:3000.
 * Where nothing listens there — CI — it is refused and the query simply errors;
 * on a machine running anything on that port it gets a 200 of HTML instead, and
 * a component expecting an array crashes on a string.
 *
 * Rejecting alone is not enough: React Query swallows the rejection, so a
 * missing mock would pass unnoticed until something answered on that port. The
 * request is recorded and the test that made it fails in `afterEach`, naming it.
 * The fix is always in the spec — mock the hook, or seed the query cache.
 *
 * Guarded because a spec that mocks `@/services/api` wholesale hands this file
 * the mock, which has no defaults to set.
 */
const unmocked: string[] = []

if (api.defaults) {
  api.defaults.adapter = (config) => {
    const request = `${config.method?.toUpperCase()} ${config.url}`
    unmocked.push(request)
    return Promise.reject(new Error(`Unmocked request in a unit test: ${request}`))
  }
}

beforeEach(() => {
  unmocked.length = 0
})

afterEach(() => {
  if (unmocked.length === 0) return
  const requests = [...new Set(unmocked)].join(', ')
  unmocked.length = 0
  throw new Error(`This test reached the network — mock it or seed the cache: ${requests}`)
})
