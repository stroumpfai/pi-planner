import { api } from './api'
import type { Project, Snapshot } from '@/types'

export const snapshotsApi = {
  list: (projectId: string) =>
    api.get<Snapshot[]>(`/projects/${projectId}/snapshots/`).then((r) => r.data),

  create: (projectId: string, body: { name: string }) =>
    api.post<Snapshot>(`/projects/${projectId}/snapshots/`, body).then((r) => r.data),

  delete: (projectId: string, snapshotId: string) =>
    api.delete(`/projects/${projectId}/snapshots/${snapshotId}`),

  restore: (projectId: string, snapshotId: string) =>
    api.post<Project>(`/projects/${projectId}/snapshots/${snapshotId}/restore`).then((r) => r.data),
}
