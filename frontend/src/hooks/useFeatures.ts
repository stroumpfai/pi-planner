import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { featuresApi } from '@/services/features'
import type { FeatureCreate, FeatureSplitRequest, FeatureUpdate } from '@/types'

const prefix = (projectId: string) => ['features', projectId] as const
const key = (projectId: string, sort: string) => [...prefix(projectId), sort] as const

export const useFeatures = (projectId: string, sort: 'created_at' | 'name' = 'created_at') =>
  useQuery({
    queryKey: key(projectId, sort),
    queryFn: () => featuresApi.list(projectId, sort),
    enabled: !!projectId,
  })

export const useFeature = (featureId: string) =>
  useQuery({
    queryKey: ['feature', featureId],
    queryFn: () => featuresApi.get(featureId),
    enabled: !!featureId,
  })

export const useCreateFeature = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FeatureCreate) => featuresApi.create(projectId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: prefix(projectId) })
      // Typing a State in the item modal adds it to the project's list.
      qc.invalidateQueries({ queryKey: ['states', projectId] })
    },
  })
}

export const useUpdateFeature = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ featureId, body }: { featureId: string; body: FeatureUpdate }) =>
      featuresApi.update(featureId, body),
    onSuccess: (_data, { body }) => {
      qc.invalidateQueries({ queryKey: prefix(projectId) })
      // Typing a State in the item modal adds it to the project's list.
      qc.invalidateQueries({ queryKey: ['states', projectId] })
      // Feature move operations may delete groups and affect capacity
      if ('location' in body || 'swimlane_id' in body) {
        qc.invalidateQueries({ queryKey: ['pbis', projectId] })
        qc.invalidateQueries({ queryKey: ['groups'] })
        qc.invalidateQueries({ queryKey: ['sprints'] })
        qc.invalidateQueries({ queryKey: ['swimlines'] })
        qc.invalidateQueries({ queryKey: ['pis'] })
      }
    },
  })
}

export const useSplitFeature = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ featureId, body }: { featureId: string; body: FeatureSplitRequest }) =>
      featuresApi.split(featureId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: prefix(projectId) })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['sprints'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
    },
  })
}

export const useCancelContinuation = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (featureId: string) => featuresApi.cancelContinuation(featureId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: prefix(projectId) })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['sprints'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
    },
  })
}

export const useDeleteFeature = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (featureId: string) => featuresApi.delete(featureId),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}

export const useClearBacklog = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => featuresApi.clearBacklog(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}

export const useClearAllFeatures = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => featuresApi.clearAll(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: prefix(projectId) })
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
    },
  })
}
