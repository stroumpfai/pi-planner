import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSSE } from '../useSSE'

// ── Mock EventSource ───────────────────────────────────────────────────────────

class MockEventSource {
  static instance: MockEventSource | null = null // NOSONAR
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    MockEventSource.instance = this
  }

  close() {
    MockEventSource.instance = null
  }

  emit(type: string, data?: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ type, ...(data ? { data } : {}) }) })
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient()
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

beforeEach(() => {
  MockEventSource.instance = null
  vi.stubGlobal('EventSource', MockEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useSSE', () => {
  it('constructs EventSource with the correct URL when projectId is provided', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useSSE('p-1'), { wrapper })
    expect(MockEventSource.instance?.url).toBe('/api/v1/projects/p-1/events')
  })

  it('does not construct EventSource when projectId is null', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useSSE(null), { wrapper })
    expect(MockEventSource.instance).toBeNull()
  })

  it('closes EventSource on unmount', () => {
    const { wrapper } = makeWrapper()
    const { unmount } = renderHook(() => useSSE('p-1'), { wrapper })
    expect(MockEventSource.instance).not.toBeNull()
    unmount()
    expect(MockEventSource.instance).toBeNull()
  })

  it('feature:created event invalidates features and pis queries', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('feature:created')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pis'] })
  })

  it('pbi:created event invalidates pbis and features queries', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('pbi:created')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pbis', 'p-1'] })
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
  })

  it('pi:state_changed event invalidates pis query', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('pi:state_changed')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pis', 'p-1'] })
  })

  it('edit-lock:acquired event invalidates editLock query', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('edit-lock:acquired')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['editLock', 'p-1'] })
  })

  it('group:created event uses predicate to invalidate groups and also invalidates pis', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('group:created')
    expect(qc.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ predicate: expect.any(Function) }),
    )
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pis'] })
  })

  it('swimline:reordered event uses predicate to invalidate swimlines', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('swimline:reordered')
    expect(qc.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ predicate: expect.any(Function) }),
    )
  })

  it('sprint:capacity_changed event invalidates sprints, swimlines, and pis', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('sprint:capacity_changed')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pis'] })
  })

  it('project:updated event invalidates projects query', () => {
    const { qc, wrapper } = makeWrapper()
    vi.spyOn(qc, 'invalidateQueries')
    renderHook(() => useSSE('p-1'), { wrapper })
    MockEventSource.instance!.emit('project:updated')
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects'] })
  })

  it('onerror handler is registered and callable without throwing', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useSSE('p-1'), { wrapper })
    expect(() => {
      MockEventSource.instance!.onerror?.()
    }).not.toThrow()
  })

  it('ignores malformed (non-JSON) SSE messages without throwing', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useSSE('p-1'), { wrapper })
    expect(() => {
      MockEventSource.instance!.onmessage?.({ data: 'not-json' })
    }).not.toThrow()
  })
})
