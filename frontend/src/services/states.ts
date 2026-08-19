import { api } from './api'
import type { ProjectState, StateItemType } from '@/types'

export const statesApi = {
  list: (projectId: string) =>
    api.get<ProjectState[]>(`/projects/${projectId}/states/`).then((r) => r.data),

  create: (projectId: string, body: { item_type: StateItemType; value: string }) =>
    api.post<ProjectState>(`/projects/${projectId}/states/`, body).then((r) => r.data),

  update: (projectId: string, stateId: string, body: { value: string }) =>
    api.patch<ProjectState>(`/projects/${projectId}/states/${stateId}`, body).then((r) => r.data),

  reorder: (projectId: string, body: { item_type: StateItemType; order: string[] }) =>
    api.post<ProjectState[]>(`/projects/${projectId}/states/reorder`, body).then((r) => r.data),

  delete: (projectId: string, stateId: string) =>
    api.delete(`/projects/${projectId}/states/${stateId}`),
}
