import { api } from './api'
import type { Feature, FeatureCreate, FeatureUpdate } from '@/types'

export const featuresApi = {
  list: (projectId: string) =>
    api.get<Feature[]>(`/projects/${projectId}/features`).then((r) => r.data),

  get: (featureId: string) =>
    api.get<Feature>(`/features/${featureId}`).then((r) => r.data),

  create: (projectId: string, body: FeatureCreate) =>
    api.post<Feature>(`/projects/${projectId}/features`, body).then((r) => r.data),

  update: (featureId: string, body: FeatureUpdate) =>
    api.patch<Feature>(`/features/${featureId}`, body).then((r) => r.data),

  delete: (featureId: string) =>
    api.delete(`/features/${featureId}`),
}
