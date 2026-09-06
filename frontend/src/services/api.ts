import axios, { type AxiosError, type AxiosResponse } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status
    const url = error.config?.url ?? ''

    // Session expired — clear user so the login form re-renders
    if (status === 401 && !url.includes('/auth/login')) {
      useAuthStore.getState().setUser(null)
    }

    // Server errors — show a toast so the user knows something went wrong
    if (status !== undefined && status >= 500) {
      toast.error('Server error — please try again')
    }

    // Edit-lock conflict — a different user holds the lock (server-side single-writer
    // enforcement). Business 409s carry `detail.error` instead and are handled inline.
    if (status === 409) {
      const detail = (error.response?.data as { detail?: { locked_by?: string } })?.detail
      if (detail?.locked_by) {
        toast.error(`${detail.locked_by} is editing this project — your change was not saved`)
      }
    }

    return Promise.reject(error)
  },
)

/** The body FastAPI wraps our business errors in: `{ detail: { error, message, … } }`. */
export interface ApiErrorDetail {
  error: string
  message: string
}

/**
 * The `detail` object of a business error, or `null` for anything else.
 *
 * The interceptor above deliberately leaves these alone — a 409 carrying
 * `detail.error` is a rule the caller has to explain in its own words ("that name
 * is taken"), not a generic toast. This is how a caller gets at it without every
 * service re-deriving the same cast.
 */
export function errorDetail<T extends ApiErrorDetail = ApiErrorDetail>(err: unknown): T | null {
  const detail = (err as AxiosError<{ detail?: unknown }> | undefined)?.response?.data?.detail
  if (detail !== null && typeof detail === 'object' && 'error' in detail) {
    return detail as T
  }
  return null
}

/**
 * The strong `ETag` a team read carries, which the matching write must quote back
 * in `If-Match` (teams.md §4.2).
 *
 * Missing is a hard error rather than an empty string: sending no `If-Match` earns
 * a 428, and sending `""` earns a 412 — both of which would read as a server bug
 * far from the read that actually failed to produce a tag.
 */
export function etagOf(response: AxiosResponse): string {
  const etag: unknown = response.headers['etag']
  if (typeof etag !== 'string' || etag === '') {
    throw new Error('Response carried no ETag; this row cannot be written to safely')
  }
  return etag
}
