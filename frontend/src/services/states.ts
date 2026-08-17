import { api } from './api'
import type { ProjectState, StateItemType } from '@/types'

export const statesApi = {
  list: (projectId: string) =>
    api.get<ProjectState[]>(`/projects/${projectId}/states/`).then((r) => r.data),

  create: (projectId: string, body: { item_type: StateItemType; value: string }) =>
    api.post<ProjectState>(`/projects/${projectId}/states/`, body).then((r) => r.data),

  delete: (projectId: string, stateId: string) =>
    api.delete(`/projects/${projectId}/states/${stateId}`),
}
