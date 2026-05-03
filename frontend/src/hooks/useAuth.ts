import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/services/auth'
import { useAuthStore } from '@/stores/authStore'
import type { LoginRequest } from '@/types'

export const useCurrentUser = () => {
  const setUser = useAuthStore((s) => s.setUser)
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.me(),
    retry: false,
    staleTime: Infinity,
  })
  useEffect(() => {
    setUser(query.data ?? null)
  }, [query.data, setUser])
  return query
}

export const useLogin = () => {
  const qc = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: (body: LoginRequest) => authApi.login(body),
    onSuccess: (data) => {
      setUser(data.user)
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export const useLogout = () => {
  const qc = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      setUser(null)
      qc.clear()
    },
  })
}
