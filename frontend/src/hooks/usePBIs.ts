import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pbisApi } from '@/services/pbis'
import type { PBICreate, PBIUpdate } from '@/types'

// prefix invalidates all PBI queries for a project regardless of featureId filter
const prefix = (projectId: string) => ['pbis', projectId] as const
const key = (projectId: string, featureId?: string) => [...prefix(projectId), featureId] as const

export const usePBIs = (projectId: string, featureId?: string) =>
  useQuery({
    queryKey: key(projectId, featureId),
    queryFn: () => pbisApi.list(projectId, featureId),
    enabled: !!projectId,
  })

export const useCreatePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PBICreate) => pbisApi.create(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}

export const useUpdatePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbiId, body }: { pbiId: string; body: PBIUpdate }) =>
      pbisApi.update(pbiId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}

export const useDeletePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pbiId: string) => pbisApi.delete(pbiId),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}
