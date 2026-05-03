import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pbisApi } from '@/services/pbis'
import type { PBICreate, PBIUpdate } from '@/types'

const key = (projectId: string) => ['pbis', projectId] as const

export const usePBIs = (projectId: string) =>
  useQuery({
    queryKey: key(projectId),
    queryFn: () => pbisApi.list(projectId),
    enabled: !!projectId,
  })

export const useCreatePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PBICreate) => pbisApi.create(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useUpdatePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbiId, body }: { pbiId: string; body: PBIUpdate }) =>
      pbisApi.update(pbiId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useDeletePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pbiId: string) => pbisApi.delete(pbiId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}
