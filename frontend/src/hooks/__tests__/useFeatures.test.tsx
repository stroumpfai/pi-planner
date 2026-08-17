import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useFeatures,
  useFeature,
  useCreateFeature,
  useUpdateFeature,
  useDeleteFeature,
  useClearBacklog,
  useClearAllFeatures,
} from '../useFeatures'
import * as featuresService from '@/services/features'

vi.mock('@/services/features')
const mockApi = vi.mocked(featuresService.featuresApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('useFeatures / useFeature queries', () => {
  it('lists features with the default sort', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ system_id: 'f-1' }])
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useFeatures('p-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ system_id: 'f-1' }]))
    expect(mockApi.list).toHaveBeenCalledWith('p-1', 'created_at')
  })

  it('does not list when projectId is empty', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    renderHook(() => useFeatures(''), { wrapper })
    expect(mockApi.list).not.toHaveBeenCalled()
  })

  it('fetches a single feature by id', async () => {
    mockApi.get = vi.fn().mockResolvedValue({ system_id: 'f-1' })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useFeature('f-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ system_id: 'f-1' }))
    expect(mockApi.get).toHaveBeenCalledWith('f-1')
  })
})

describe('useFeatures mutations', () => {
  it('useCreateFeature creates and invalidates the features list', async () => {
    mockApi.create = vi.fn().mockResolvedValue({ system_id: 'f-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateFeature('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ title: 'Auth' })
    })

    expect(mockApi.create).toHaveBeenCalledWith('p-1', { title: 'Auth' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
  })

  it('useUpdateFeature only invalidates the features list for a plain edit', async () => {
    mockApi.update = vi.fn().mockResolvedValue({ system_id: 'f-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateFeature('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ featureId: 'f-1', body: { title: 'Renamed' } })
    })

    expect(mockApi.update).toHaveBeenCalledWith('f-1', { title: 'Renamed' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['sprints'] })
  })

  it('useUpdateFeature broadly invalidates when the feature is moved', async () => {
    mockApi.update = vi.fn().mockResolvedValue({ system_id: 'f-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateFeature('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ featureId: 'f-1', body: { swimlane_id: 'sw-1' } })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pbis', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['groups'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sprints'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['swimlines'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pis'] })
  })

  it('useDeleteFeature deletes and invalidates the features list', async () => {
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteFeature('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('f-1')
    })

    expect(mockApi.delete).toHaveBeenCalledWith('f-1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
  })

  it('useClearBacklog clears and invalidates the features list', async () => {
    mockApi.clearBacklog = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useClearBacklog('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockApi.clearBacklog).toHaveBeenCalledWith('p-1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
  })

  it('useClearAllFeatures clears everything and broadly invalidates', async () => {
    mockApi.clearAll = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useClearAllFeatures('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockApi.clearAll).toHaveBeenCalledWith('p-1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['groups'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['swimlines'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pis'] })
  })
})

describe('State List invalidation', () => {
  // Regression: typing a new State on one item left every other item's dropdown empty,
  // because the global 5-minute staleTime kept serving the pre-existing empty list.
  it('useUpdateFeature invalidates the State Lists', async () => {
    mockApi.update = vi.fn().mockResolvedValue({ system_id: 'f-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateFeature('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ featureId: 'f-1', body: { state_value: 'In Review' } })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
  })

  it('useCreateFeature invalidates the State Lists', async () => {
    mockApi.create = vi.fn().mockResolvedValue({ system_id: 'f-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateFeature('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ title: 'Auth', state_value: 'New' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
  })
})
