import { api } from './api'
import type { Feature, FeatureCreate, FeatureSplitRequest, FeatureUpdate } from '@/types'

export interface BulkDeleteResult {
  deleted_features: number
}

export const featuresApi = {
  list: (projectId: string, sort: 'created_at' | 'name' = 'created_at') =>
    api.get<Feature[]>(`/projects/${projectId}/features`, { params: { sort } }).then((r) => r.data),

  get: (featureId: string) =>
    api.get<Feature>(`/features/${featureId}`).then((r) => r.data),

  create: (projectId: string, body: FeatureCreate) =>
    api.post<Feature>(`/projects/${projectId}/features`, body).then((r) => r.data),

  update: (featureId: string, body: FeatureUpdate) =>
    api.patch<Feature>(`/features/${featureId}`, body).then((r) => r.data),

  split: (featureId: string, body: FeatureSplitRequest) =>
    api.post<Feature>(`/features/${featureId}/split`, body).then((r) => r.data),

  cancelContinuation: (featureId: string) =>
    api.post<Feature>(`/features/${featureId}/cancel-continuation`).then((r) => r.data),

  delete: (featureId: string) =>
    api.delete(`/features/${featureId}`),

  clearBacklog: (projectId: string) =>
    api.delete<BulkDeleteResult>(`/projects/${projectId}/backlog`).then((r) => r.data),

  clearAll: (projectId: string) =>
    api.delete<BulkDeleteResult>(`/projects/${projectId}/features`).then((r) => r.data),
}
