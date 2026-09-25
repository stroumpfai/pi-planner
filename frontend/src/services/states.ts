import { api } from './api'
import type { ProjectState, StateItemType } from '@/types'

/** A State's declared done-ness; `null` means uncategorised. */
export type StateCategory = ProjectState['category']

export const statesApi = {
  list: (projectId: string) =>
    api.get<ProjectState[]>(`/projects/${projectId}/states/`).then((r) => r.data),

  create: (projectId: string, body: { item_type: StateItemType; value: string }) =>
    api.post<ProjectState>(`/projects/${projectId}/states/`, body).then((r) => r.data),

  /**
   * PATCH semantics: an absent key is left alone, and an explicit `category: null`
   * clears the category. Send only the field being changed.
   */
  update: (
    projectId: string,
    stateId: string,
    body: { value?: string; category?: StateCategory },
  ) =>
    api.patch<ProjectState>(`/projects/${projectId}/states/${stateId}`, body).then((r) => r.data),

  reorder: (projectId: string, body: { item_type: StateItemType; order: string[] }) =>
    api.post<ProjectState[]>(`/projects/${projectId}/states/reorder`, body).then((r) => r.data),

  delete: (projectId: string, stateId: string) =>
    api.delete(`/projects/${projectId}/states/${stateId}`),
}
