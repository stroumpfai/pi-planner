import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useSprints, useUpdateSprint } from '../useSprints'
import { useCsvImport } from '../useCsvImport'
import * as sprintsService from '@/services/sprints'
import * as csvImportService from '@/services/csvImport'

vi.mock('@/services/sprints')
vi.mock('@/services/csvImport')
const mockSprints = vi.mocked(sprintsService.sprintsApi)
const mockCsv = vi.mocked(csvImportService.csvImportApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSprints', () => {
  it('fetches the sprint list for a PI', async () => {
    mockSprints.list = vi.fn().mockResolvedValue([{ system_id: 's-1' }])
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSprints('pi-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ system_id: 's-1' }]))
    expect(mockSprints.list).toHaveBeenCalledWith('pi-1')
  })

  it('does not fetch when piId is empty', () => {
    mockSprints.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    renderHook(() => useSprints(''), { wrapper })
    expect(mockSprints.list).not.toHaveBeenCalled()
  })
})

describe('useUpdateSprint', () => {
  it('updates a sprint and invalidates sprints, swimlines and pis', async () => {
    mockSprints.update = vi.fn().mockResolvedValue({ system_id: 's-1' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateSprint('pi-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ sprintId: 's-1', body: { capacity: 10 } })
    })

    expect(mockSprints.update).toHaveBeenCalledWith('s-1', { capacity: 10 })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sprints', 'pi-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['swimlines'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pis'] })
  })
})

describe('useCsvImport', () => {
  it('executes the import and invalidates the features list on success', async () => {
    mockCsv.execute = vi.fn().mockResolvedValue({ imported: 3 })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCsvImport('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ rows: [] })
    })

    expect(mockCsv.execute).toHaveBeenCalledWith('p-1', { rows: [] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
  })
})
