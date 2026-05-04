import { api } from './api'
import type { Swimline, SwimlineCreate, SwimlineUpdate } from '@/types'

export const swimlinesApi = {
  list: (piId: string) =>
    api.get<Swimline[]>(`/pis/${piId}/swimlines`).then((r) => r.data),

  get: (swimlineId: string) =>
    api.get<Swimline>(`/swimlines/${swimlineId}`).then((r) => r.data),

  create: (piId: string, body: SwimlineCreate) =>
    api.post<Swimline>(`/pis/${piId}/swimlines`, body).then((r) => r.data),

  update: (swimlineId: string, body: SwimlineUpdate) =>
    api.patch<Swimline>(`/swimlines/${swimlineId}`, body).then((r) => r.data),

  delete: (swimlineId: string) =>
    api.delete(`/swimlines/${swimlineId}`),

  reorder: (swimlineId: string, order: string[]) =>
    api.post<Swimline[]>(`/swimlines/${swimlineId}/reorder`, { order }).then((r) => r.data),
}
