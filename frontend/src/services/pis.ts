import { api } from './api'
import type { PI, PICreate, PIUpdate } from '@/types'

export const pisApi = {
  list: (projectId: string) =>
    api.get<PI[]>(`/projects/${projectId}/pis`).then((r) => r.data),

  get: (piId: string) =>
    api.get<PI>(`/pis/${piId}`).then((r) => r.data),

  create: (projectId: string, body: PICreate) =>
    api.post<PI>(`/projects/${projectId}/pis`, body).then((r) => r.data),

  update: (piId: string, body: PIUpdate) =>
    api.patch<PI>(`/pis/${piId}`, body).then((r) => r.data),

  delete: (piId: string) =>
    api.delete(`/pis/${piId}`),
}
