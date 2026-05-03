import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pisApi } from '@/services/pis'
import type { PICreate, PIUpdate } from '@/types'

const key = (projectId: string) => ['pis', projectId] as const

export const usePIs = (projectId: string) =>
  useQuery({
    queryKey: key(projectId),
    queryFn: () => pisApi.list(projectId),
    enabled: !!projectId,
  })

export const usePI = (piId: string) =>
  useQuery({
    queryKey: ['pi', piId],
    queryFn: () => pisApi.get(piId),
    enabled: !!piId,
  })

export const useCreatePI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PICreate) => pisApi.create(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useUpdatePI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ piId, body }: { piId: string; body: PIUpdate }) =>
      pisApi.update(piId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useDeletePI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (piId: string) => pisApi.delete(piId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}
