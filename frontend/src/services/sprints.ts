import { api } from './api'
import type { Sprint, SprintCreate, SprintUpdate } from '@/types'

export const sprintsApi = {
  list: (piId: string) =>
    api.get<Sprint[]>(`/pis/${piId}/sprints`).then((r) => r.data),

  create: (piId: string, body: SprintCreate) =>
    api.post<Sprint>(`/pis/${piId}/sprints`, body).then((r) => r.data),

  update: (sprintId: string, body: SprintUpdate) =>
    api.patch<Sprint>(`/sprints/${sprintId}`, body).then((r) => r.data),
}
