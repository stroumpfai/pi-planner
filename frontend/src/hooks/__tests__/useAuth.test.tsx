import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { useCurrentUser, useLogin, useLogout } from '../useAuth'
import * as authService from '@/services/auth'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

vi.mock('@/services/auth')
const mockAuth = vi.mocked(authService.authApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    qc,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  }
}

const stamps = { created_at: '2026-08-10T09:00:00+00:00', last_login_at: null, password_changed_at: null }
const alice: User = { username: 'alice', display_name: 'Alice', role: 'editor', ...stamps }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('useCurrentUser', () => {
  it('mirrors the fetched user into the auth store', async () => {
    mockAuth.me = vi.fn().mockResolvedValue(alice)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCurrentUser(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(alice))
    expect(useAuthStore.getState().user).toEqual(alice)
  })

  it('clears the store when the session is gone', async () => {
    // retry: false, so a single 401 is terminal — this is what an expired session
    // looks like on the first load of the app.
    useAuthStore.setState({ user: alice })
    mockAuth.me = vi.fn().mockRejectedValue(new Error('401'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCurrentUser(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockAuth.me).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('useLogin', () => {
  it('stores the user and refetches me on success', async () => {
    mockAuth.login = vi.fn().mockResolvedValue({ user: alice })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useLogin(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ username: 'alice', password: 'correct-horse-battery' })
    })

    expect(mockAuth.login).toHaveBeenCalledWith({ username: 'alice', password: 'correct-horse-battery' })
    expect(useAuthStore.getState().user).toEqual(alice)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] })
  })

  it('leaves the store untouched when the credentials are rejected', async () => {
    mockAuth.login = vi.fn().mockRejectedValue(new Error('invalid credentials'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useLogin(), { wrapper })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ username: 'alice', password: 'wrong' }),
      ).rejects.toThrow('invalid credentials')
    })

    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('useLogout', () => {
  it('clears the user and drops every cached query', async () => {
    useAuthStore.setState({ user: alice, isEditing: true })
    mockAuth.logout = vi.fn().mockResolvedValue(undefined)
    const { qc, wrapper } = makeWrapper()
    // Another project's data must not survive into the next user's session.
    qc.setQueryData(['features', 'p-1'], [{ system_id: 'f-1' }])
    const { result } = renderHook(() => useLogout(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(useAuthStore.getState().user).toBeNull()
    expect(qc.getQueryData(['features', 'p-1'])).toBeUndefined()
  })

  it('keeps the user when the logout request fails', async () => {
    useAuthStore.setState({ user: alice })
    mockAuth.logout = vi.fn().mockRejectedValue(new Error('network down'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useLogout(), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('network down')
    })

    expect(useAuthStore.getState().user).toEqual(alice)
  })
})
