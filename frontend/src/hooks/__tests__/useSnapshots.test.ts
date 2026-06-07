import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useSnapshots,
  useCreateSnapshot,
  useDeleteSnapshot,
  useRestoreSnapshot,
} from '../useSnapshots'
import * as snapshotsService from '@/services/snapshots'
import type { Snapshot } from '@/types'

vi.mock('@/services/snapshots')
const mockApi = vi.mocked(snapshotsService.snapshotsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

const fakeSnapshot: Snapshot = {
  system_id: 'snap-1',
  name: 'Before refactor',
  created_at: '2026-06-01T10:00:00Z',
  created_by: 'alice',
}

beforeEach(() => vi.clearAllMocks())

describe('useSnapshots', () => {
  it('fetches the snapshot list for a project', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot])
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSnapshots('p-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([fakeSnapshot]))
    expect(mockApi.list).toHaveBeenCalledWith('p-1')
  })

  it('does not fetch when projectId is empty', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    renderHook(() => useSnapshots(''), { wrapper })
    expect(mockApi.list).not.toHaveBeenCalled()
  })
})

describe('useCreateSnapshot', () => {
  it('calls create and invalidates the snapshots list on success', async () => {
    mockApi.create = vi.fn().mockResolvedValue(fakeSnapshot)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateSnapshot('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ name: 'Before refactor' })
    })

    expect(mockApi.create).toHaveBeenCalledWith('p-1', { name: 'Before refactor' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['snapshots', 'p-1'] })
  })
})

describe('useDeleteSnapshot', () => {
  it('calls delete and invalidates the snapshots list on success', async () => {
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteSnapshot('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('snap-1')
    })

    expect(mockApi.delete).toHaveBeenCalledWith('p-1', 'snap-1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['snapshots', 'p-1'] })
  })
})

describe('useRestoreSnapshot', () => {
  it('calls restore and broadly invalidates project-scoped queries on success', async () => {
    mockApi.restore = vi.fn().mockResolvedValue({ system_id: 'p-1', name: 'Project' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRestoreSnapshot('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('snap-1')
    })

    expect(mockApi.restore).toHaveBeenCalledWith('p-1', 'snap-1')

    // Broad invalidation: every project-scoped resource should be refetched
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['projects'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pbis', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pis', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['snapshots', 'p-1'] })

    const predicateCalls = invalidateSpy.mock.calls.filter(
      ([arg]) => arg && typeof arg === 'object' && 'predicate' in arg,
    )
    expect(predicateCalls.length).toBeGreaterThanOrEqual(3) // swimlines, groups, sprints
  })
})
