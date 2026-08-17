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

// A PBI change (effort, grouping, placement) affects server-computed effort
// rollups shown in the sprint columns, swimlane totals and PI totals, so
// invalidate those queries too — mirroring the feature-move invalidation set.
function invalidatePBIRelated(qc: ReturnType<typeof useQueryClient>, projectId: string): void {
  qc.invalidateQueries({ queryKey: prefix(projectId) })
  qc.invalidateQueries({ queryKey: ['features', projectId] })
  qc.invalidateQueries({ queryKey: ['groups'] })
  qc.invalidateQueries({ queryKey: ['sprints'] })
  qc.invalidateQueries({ queryKey: ['swimlines'] })
  qc.invalidateQueries({ queryKey: ['pis'] })
  // Typing a State in the item modal adds it to the project's list.
  qc.invalidateQueries({ queryKey: ['states', projectId] })
}

export const useCreatePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PBICreate) => pbisApi.create(projectId, body),
    onSuccess: () => invalidatePBIRelated(qc, projectId),
  })
}

export const useUpdatePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbiId, body }: { pbiId: string; body: PBIUpdate }) =>
      pbisApi.update(pbiId, body),
    onSuccess: () => invalidatePBIRelated(qc, projectId),
  })
}

export const useDeletePBI = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pbiId: string) => pbisApi.delete(pbiId),
    onSuccess: () => invalidatePBIRelated(qc, projectId),
  })
}
