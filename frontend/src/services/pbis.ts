import { api } from './api'
import type { PBI, PBICreate, PBIUpdate } from '@/types'

export const pbisApi = {
  list: (projectId: string, featureId?: string) =>
    api
      .get<PBI[]>(`/projects/${projectId}/pbis`, { params: featureId ? { feature_id: featureId } : {} })
      .then((r) => r.data),

  get: (pbiId: string) =>
    api.get<PBI>(`/pbis/${pbiId}`).then((r) => r.data),

  create: (projectId: string, body: PBICreate) =>
    api.post<PBI>(`/projects/${projectId}/pbis`, body).then((r) => r.data),

  update: (pbiId: string, body: PBIUpdate) =>
    api.patch<PBI>(`/pbis/${pbiId}`, body).then((r) => r.data),

  delete: (pbiId: string) =>
    api.delete(`/pbis/${pbiId}`),
}
