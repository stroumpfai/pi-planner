import axios, { type AxiosError } from 'axios'
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

    return Promise.reject(error)
  },
)
