import { api } from './api'
import type { EditLock } from '@/types'

export const editLockApi = {
  get: (projectId: string) =>
    api.get<EditLock>(`/projects/${projectId}/edit-lock`).then((r) => r.data),

  acquire: (projectId: string) =>
    api.post<EditLock>(`/projects/${projectId}/edit-lock/acquire`).then((r) => r.data),

  release: (projectId: string) =>
    api.post(`/projects/${projectId}/edit-lock/release`),

  keepalive: (projectId: string) =>
    api.post<EditLock>(`/projects/${projectId}/edit-lock/keepalive`).then((r) => r.data),
}
