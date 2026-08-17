import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { usePBIs, useCreatePBI, useUpdatePBI, useDeletePBI } from '../usePBIs'
import * as pbisService from '@/services/pbis'

vi.mock('@/services/pbis')
const mockApi = vi.mocked(pbisService.pbisApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('usePBIs query', () => {
  it('lists PBIs for a feature', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ system_id: 'pbi-1' }])
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePBIs('p-1', 'f-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ system_id: 'pbi-1' }]))
    expect(mockApi.list).toHaveBeenCalledWith('p-1', 'f-1')
  })

  it('does not list when projectId is empty', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    renderHook(() => usePBIs(''), { wrapper })
    expect(mockApi.list).not.toHaveBeenCalled()
  })
})

describe('usePBIs mutations invalidate the effort-rollup queries', () => {
  // Effort sums shown in the sprint columns, swimlane totals and PI totals are
  // computed server-side, so a PBI change must refresh those queries too.
  const expectBroadInvalidation = (invalidateSpy: ReturnType<typeof vi.spyOn>) => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pbis', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['groups'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sprints'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['swimlines'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pis'] })
  }

  it('useUpdatePBI broadly invalidates after an effort edit', async () => {
    mockApi.update = vi.fn().mockResolvedValue({ system_id: 'pbi-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdatePBI('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ pbiId: 'pbi-1', body: { effort: 8 } })
    })

    expect(mockApi.update).toHaveBeenCalledWith('pbi-1', { effort: 8 })
    expectBroadInvalidation(invalidateSpy)
  })

  it('useCreatePBI broadly invalidates', async () => {
    mockApi.create = vi.fn().mockResolvedValue({ system_id: 'pbi-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreatePBI('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ title: 'New', parent_feature_system_id: 'f-1' })
    })

    expectBroadInvalidation(invalidateSpy)
  })

  it('useDeletePBI broadly invalidates', async () => {
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeletePBI('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('pbi-1')
    })

    expect(mockApi.delete).toHaveBeenCalledWith('pbi-1')
    expectBroadInvalidation(invalidateSpy)
  })
})

describe('State List invalidation', () => {
  // Regression: a State typed on one PBI did not appear in any other PBI's dropdown.
  it('useUpdatePBI invalidates the State Lists', async () => {
    mockApi.update = vi.fn().mockResolvedValue({ system_id: 'pbi-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdatePBI('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ pbiId: 'pbi-1', body: { state_value: 'Committed' } })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
  })
})
