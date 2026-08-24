import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AxiosError, type AxiosAdapter, type AxiosRequestConfig } from 'axios'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { api } from '../api'
import { authApi } from '../auth'
import { editLockApi } from '../editLock'
import { useAcquireEditLock } from '@/hooks/useEditLock'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'

// These specs drive the real axios instance so its response interceptor runs.
// Swapping the adapter is the whole mock: everything above it — services, hooks,
// the stores the interceptor writes to — is the real thing.
const realAdapter = api.defaults.adapter

function respondWith(status: number, data: unknown = {}) {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    const response = {
      data,
      status,
      statusText: '',
      headers: {},
      config: config as never,
    }
    if (status >= 200 && status < 300) return Promise.resolve(response)
    return Promise.reject(new AxiosError('Request failed', 'ERR_BAD_REQUEST', config as never, {}, response))
  }
  api.defaults.adapter = adapter
}

/** A request that never reached the server — no `response` on the error at all. */
function failToConnect() {
  api.defaults.adapter = (config: AxiosRequestConfig) =>
    Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config as never, {}))
}

const messages = () => useToastStore.getState().toasts.map((t) => t.message)

const stamps = { created_at: '2026-08-10T09:00:00+00:00', last_login_at: null, password_changed_at: null }
const alice = { username: 'alice', display_name: null, role: 'editor' as const, ...stamps }

beforeEach(() => {
  useAuthStore.setState({ user: alice, isEditing: false })
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  api.defaults.adapter = realAdapter
})

describe('api response interceptor', () => {
  it('passes a successful response through untouched', async () => {
    respondWith(200, alice)
    await expect(authApi.me()).resolves.toEqual(alice)
    expect(useAuthStore.getState().user).toEqual(alice)
    expect(messages()).toEqual([])
  })

  it('clears the user when the session has expired', async () => {
    respondWith(401)
    await expect(editLockApi.get('p-1')).rejects.toThrow()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('does not clear the user when a login attempt is rejected', async () => {
    // A 401 from /auth/login means "wrong password", not "your session is gone".
    // Treating it as the latter would blank out whoever is already signed in.
    respondWith(401)
    await expect(authApi.login({ username: 'alice', password: 'wrong' })).rejects.toThrow()
    expect(useAuthStore.getState().user).toEqual(alice)
    expect(messages()).toEqual([])
  })

  it('toasts on a server error', async () => {
    respondWith(500)
    await expect(editLockApi.get('p-1')).rejects.toThrow()
    expect(messages()).toEqual(['Server error — please try again'])
  })

  it('toasts on any 5xx, not just 500', async () => {
    respondWith(503)
    await expect(editLockApi.get('p-1')).rejects.toThrow()
    expect(messages()).toEqual(['Server error — please try again'])
  })

  it('names the lock holder on an edit-lock conflict', async () => {
    respondWith(409, { detail: { locked_by: 'bob' } })
    await expect(editLockApi.acquire('p-1')).rejects.toThrow()
    expect(messages()).toEqual(['bob is editing this project — your change was not saved'])
  })

  it('stays silent on a business 409, which is handled inline', async () => {
    // Duplicate user_id and friends carry `detail.error` and are reported by the
    // form that caused them — a toast here would double up on the message.
    respondWith(409, { detail: { error: 'DUPLICATE_USER_ID' } })
    await expect(editLockApi.acquire('p-1')).rejects.toThrow()
    expect(messages()).toEqual([])
  })

  it('stays silent on a 404', async () => {
    respondWith(404)
    await expect(editLockApi.get('p-1')).rejects.toThrow()
    expect(messages()).toEqual([])
    expect(useAuthStore.getState().user).toEqual(alice)
  })

  it('still clears the session on a 401 that carries no request config', async () => {
    // `error.config` is optional on AxiosError; the `?? ''` fallback must not let an
    // expired session slip through as if it were a login attempt.
    api.defaults.adapter = () =>
      Promise.reject(
        new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
          data: {},
          status: 401,
          statusText: '',
          headers: {},
          config: undefined as never,
        }),
      )
    await expect(editLockApi.get('p-1')).rejects.toThrow()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('rejects without toasting when the request never reached the server', async () => {
    // No `response`, so `status` is undefined — it must not be read as a 5xx.
    failToConnect()
    await expect(editLockApi.get('p-1')).rejects.toThrow('Network Error')
    expect(messages()).toEqual([])
    expect(useAuthStore.getState().user).toEqual(alice)
  })
})

describe('acquiring a lock another user holds', () => {
  it('toasts and leaves edit mode off, end to end', async () => {
    // hook → service → axios → interceptor → stores, with only the wire faked.
    respondWith(409, { detail: { locked_by: 'bob' } })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children)
    const { result } = renderHook(() => useAcquireEditLock('p-1'), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow()
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(useAuthStore.getState().isEditing).toBe(false)
    expect(messages()).toEqual(['bob is editing this project — your change was not saved'])
  })
})
