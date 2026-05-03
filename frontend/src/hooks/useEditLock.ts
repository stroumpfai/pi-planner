import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { editLockApi } from '@/services/editLock'
import { useAuthStore } from '@/stores/authStore'

const key = (projectId: string) => ['editLock', projectId] as const

export const useEditLock = (projectId: string) =>
  useQuery({
    queryKey: key(projectId),
    queryFn: () => editLockApi.get(projectId),
    enabled: !!projectId,
    refetchInterval: 30_000,
  })

export const useAcquireEditLock = (projectId: string) => {
  const qc = useQueryClient()
  const setIsEditing = useAuthStore((s) => s.setIsEditing)
  return useMutation({
    mutationFn: () => editLockApi.acquire(projectId),
    onSuccess: () => {
      setIsEditing(true)
      qc.invalidateQueries({ queryKey: key(projectId) })
    },
  })
}

export const useReleaseEditLock = (projectId: string) => {
  const qc = useQueryClient()
  const setIsEditing = useAuthStore((s) => s.setIsEditing)
  return useMutation({
    mutationFn: () => editLockApi.release(projectId),
    onSuccess: () => {
      setIsEditing(false)
      qc.invalidateQueries({ queryKey: key(projectId) })
    },
  })
}

export const useKeepaliveEditLock = (projectId: string) =>
  useMutation({
    mutationFn: () => editLockApi.keepalive(projectId),
  })
