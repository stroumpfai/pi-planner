import { api } from './api'
import type { Project, ProjectCreate, ProjectUpdate } from '@/types'

export const projectsApi = {
  list: () =>
    api.get<Project[]>('/projects/').then((r) => r.data),

  get: (projectId: string) =>
    api.get<Project>(`/projects/${projectId}`).then((r) => r.data),

  create: (body: ProjectCreate) =>
    api.post<Project>('/projects/', body).then((r) => r.data),

  update: (projectId: string, body: ProjectUpdate) =>
    api.patch<Project>(`/projects/${projectId}`, body).then((r) => r.data),

  delete: (projectId: string) =>
    api.delete(`/projects/${projectId}`),
}
