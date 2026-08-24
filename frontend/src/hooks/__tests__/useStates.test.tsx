import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useCreateState,
  useDeleteState,
  useRenameState,
  useReorderStates,
  useStates,
  useStatesForType,
} from '../useStates'
import * as statesService from '@/services/states'
import type { ProjectState, StateItemType } from '@/types'

vi.mock('@/services/states')
const mockStates = vi.mocked(statesService.statesApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

let seq = 0
const makeState = (item_type: StateItemType, value: string): ProjectState => ({
  system_id: `s-${++seq}`,
  project_id: 'p-1',
  item_type,
  value,
  position: seq,
  category: null,
  created_at: '2026-08-10T09:00:00+00:00',
})

const allThreeLists = [
  makeState('feature', 'New'),
  makeState('story', 'Active'),
  makeState('bug', 'Closed'),
  makeState('feature', 'Done'),
]

beforeEach(() => vi.clearAllMocks())

describe('useStates', () => {
  it('fetches every State List for the project', async () => {
    mockStates.list = vi.fn().mockResolvedValue(allThreeLists)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useStates('p-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(allThreeLists))
    expect(mockStates.list).toHaveBeenCalledWith('p-1')
  })

  it('does not fetch when there is no project', () => {
    mockStates.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    renderHook(() => useStates(''), { wrapper })
    expect(mockStates.list).not.toHaveBeenCalled()
  })

  it('does not fetch while disabled', () => {
    // ProjectStatesModal passes its `open` flag, so a closed modal costs no request.
    mockStates.list = vi.fn().mockResolvedValue([])
    const { wrapper } = makeWrapper()
    const { rerender } = renderHook(({ open }) => useStates('p-1', open), {
      wrapper,
      initialProps: { open: false },
    })
    expect(mockStates.list).not.toHaveBeenCalled()

    rerender({ open: true })
    expect(mockStates.list).toHaveBeenCalledWith('p-1')
  })
})

describe('useStatesForType', () => {
  it('narrows the list to one item type', async () => {
    mockStates.list = vi.fn().mockResolvedValue(allThreeLists)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useStatesForType('p-1', 'feature'), { wrapper })

    await waitFor(() => expect(result.current.states).toHaveLength(2))
    expect(result.current.states.map((s) => s.value)).toEqual(['New', 'Done'])
  })

  it('reports an empty list before the fetch resolves', () => {
    mockStates.list = vi.fn(() => new Promise(() => {}))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useStatesForType('p-1', 'bug'), { wrapper })

    expect(result.current.states).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })
})

describe('useCreateState', () => {
  it('creates a state and refreshes the lists', async () => {
    mockStates.create = vi.fn().mockResolvedValue(makeState('bug', 'Triage'))
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateState('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ item_type: 'bug', value: 'Triage' })
    })

    expect(mockStates.create).toHaveBeenCalledWith('p-1', { item_type: 'bug', value: 'Triage' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
  })
})

describe('useRenameState', () => {
  it('renames a state and refreshes the items that display its value', async () => {
    mockStates.update = vi.fn().mockResolvedValue(makeState('feature', 'Started'))
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRenameState('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ stateId: 's-9', value: 'Started' })
    })

    expect(mockStates.update).toHaveBeenCalledWith('p-1', 's-9', { value: 'Started' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['features', 'p-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pbis', 'p-1'] })
  })

  it('refreshes nothing when the rename is rejected', async () => {
    mockStates.update = vi.fn().mockRejectedValue(new Error('duplicate value'))
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRenameState('p-1'), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ stateId: 's-9', value: 'New' }),
      ).rejects.toThrow('duplicate value')
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('useReorderStates', () => {
  it('sends the new order and refreshes the lists', async () => {
    mockStates.reorder = vi.fn().mockResolvedValue([])
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useReorderStates('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ item_type: 'story', order: ['s-2', 's-1'] })
    })

    expect(mockStates.reorder).toHaveBeenCalledWith('p-1', {
      item_type: 'story',
      order: ['s-2', 's-1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
  })
})

describe('useDeleteState', () => {
  it('deletes a state and refreshes the lists', async () => {
    mockStates.delete = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteState('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('s-3')
    })

    expect(mockStates.delete).toHaveBeenCalledWith('p-1', 's-3')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['states', 'p-1'] })
  })

  it('does not refresh when the delete is refused because the state is in use', async () => {
    // The backend guards deletion of a State that items still reference.
    mockStates.delete = vi.fn().mockRejectedValue(new Error('state in use'))
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteState('p-1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync('s-3')).rejects.toThrow('state in use')
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
