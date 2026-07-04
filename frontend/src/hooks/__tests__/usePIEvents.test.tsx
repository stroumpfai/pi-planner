import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  usePIEvents,
  useCreatePIEvent,
  useUpdatePIEvent,
  useDeletePIEvent,
} from '../usePIEvents'
import * as piEventsService from '@/services/piEvents'

vi.mock('@/services/piEvents')
const mockApi = vi.mocked(piEventsService.piEventsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('usePIEvents', () => {
  it('fetches events for a PI', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ system_id: 'ev-1' }])
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => usePIEvents('pi-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ system_id: 'ev-1' }]))
    expect(mockApi.list).toHaveBeenCalledWith('pi-1')
  })

  it('does not fetch when piId is empty', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    renderHook(() => usePIEvents(''), { wrapper })
    expect(mockApi.list).not.toHaveBeenCalled()
  })
})

describe('PI event mutations', () => {
  it('useCreatePIEvent creates and invalidates the events list', async () => {
    mockApi.create = vi.fn().mockResolvedValue({ system_id: 'ev-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreatePIEvent('pi-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ label: 'Demo', sprint_index: 0 })
    })

    expect(mockApi.create).toHaveBeenCalledWith('pi-1', { label: 'Demo', sprint_index: 0 })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pi-events', 'pi-1'] })
  })

  it('useUpdatePIEvent updates and invalidates the events list', async () => {
    mockApi.update = vi.fn().mockResolvedValue({ system_id: 'ev-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdatePIEvent('pi-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ eventId: 'ev-1', body: { label: 'Renamed' } })
    })

    expect(mockApi.update).toHaveBeenCalledWith('pi-1', 'ev-1', { label: 'Renamed' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pi-events', 'pi-1'] })
  })

  it('useDeletePIEvent deletes and invalidates the events list', async () => {
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeletePIEvent('pi-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('ev-1')
    })

    expect(mockApi.delete).toHaveBeenCalledWith('pi-1', 'ev-1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pi-events', 'pi-1'] })
  })
})
