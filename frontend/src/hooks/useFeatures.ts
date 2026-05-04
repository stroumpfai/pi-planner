import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { featuresApi } from '@/services/features'
import type { FeatureCreate, FeatureUpdate } from '@/types'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}

export const useUpdateFeature = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ featureId, body }: { featureId: string; body: FeatureUpdate }) =>
      featuresApi.update(featureId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}

export const useDeleteFeature = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (featureId: string) => featuresApi.delete(featureId),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefix(projectId) }),
  })
}
