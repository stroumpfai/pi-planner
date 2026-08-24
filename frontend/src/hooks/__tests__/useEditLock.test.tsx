import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useAcquireEditLock,
  useEditLock,
  useKeepaliveEditLock,
  useReleaseEditLock,
} from '../useEditLock'
import * as editLockService from '@/services/editLock'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/services/editLock')
const mockLock = vi.mocked(editLockService.editLockApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

const unlocked = { is_locked: false, locked_by_username: null, expires_at: null }
const heldByBob = { is_locked: true, locked_by_username: 'bob', expires_at: '2026-08-24T18:30:00+00:00' }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('useEditLock', () => {
  it('fetches the lock status for a project', async () => {
    mockLock.get = vi.fn().mockResolvedValue(heldByBob)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useEditLock('p-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(heldByBob))
    expect(mockLock.get).toHaveBeenCalledWith('p-1')
  })

  it('does not fetch when there is no active project', () => {
    mockLock.get = vi.fn().mockResolvedValue(unlocked)
    const { wrapper } = makeWrapper()
    renderHook(() => useEditLock(''), { wrapper })
    expect(mockLock.get).not.toHaveBeenCalled()
  })
})

describe('useAcquireEditLock', () => {
  it('turns on edit mode and refreshes the lock status', async () => {
    mockLock.acquire = vi.fn().mockResolvedValue({ ...heldByBob, locked_by_username: 'alice' })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useAcquireEditLock('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockLock.acquire).toHaveBeenCalledWith('p-1')
    expect(useAuthStore.getState().isEditing).toBe(true)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['editLock', 'p-1'] })
  })

  it('leaves edit mode off when the lock is already held (409)', async () => {
    // The single-writer rule is enforced server-side. If isEditing flipped on a
    // rejected acquire the UI would hand out write controls the API will refuse.
    mockLock.acquire = vi.fn().mockRejectedValue(new Error('Already locked'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useAcquireEditLock('p-1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('Already locked')
    })

    expect(useAuthStore.getState().isEditing).toBe(false)
  })
})

describe('useReleaseEditLock', () => {
  it('turns off edit mode and refreshes the lock status', async () => {
    useAuthStore.setState({ isEditing: true })
    mockLock.release = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useReleaseEditLock('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockLock.release).toHaveBeenCalledWith('p-1')
    expect(useAuthStore.getState().isEditing).toBe(false)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['editLock', 'p-1'] })
  })

  it('keeps edit mode on when the release request fails', async () => {
    useAuthStore.setState({ isEditing: true })
    mockLock.release = vi.fn().mockRejectedValue(new Error('network down'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useReleaseEditLock('p-1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('network down')
    })

    expect(useAuthStore.getState().isEditing).toBe(true)
  })
})

describe('useKeepaliveEditLock', () => {
  it('extends the lock', async () => {
    mockLock.keepalive = vi.fn().mockResolvedValue(heldByBob)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useKeepaliveEditLock('p-1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockLock.keepalive).toHaveBeenCalledWith('p-1')
  })

  it('surfaces a failed beat as a rejection rather than swallowing it', async () => {
    // The heartbeat runs on an interval and has no onError, so a lost beat is
    // silent by design — but mutateAsync must still reject for callers that care.
    mockLock.keepalive = vi.fn().mockRejectedValue(new Error('lock expired'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useKeepaliveEditLock('p-1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('lock expired')
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
