import { api } from './api'
import type { Group, GroupCreate, GroupUpdate } from '@/types'

export const groupsApi = {
  list: (swimlineId: string) =>
    api.get<Group[]>(`/swimlines/${swimlineId}/groups`).then((r) => r.data),

  get: (groupId: string) =>
    api.get<Group>(`/groups/${groupId}`).then((r) => r.data),

  create: (swimlineId: string, body: GroupCreate) =>
    api.post<Group>(`/swimlines/${swimlineId}/groups`, body).then((r) => r.data),

  update: (groupId: string, body: GroupUpdate) =>
    api.patch<Group>(`/groups/${groupId}`, body).then((r) => r.data),

  delete: (groupId: string) =>
    api.delete(`/groups/${groupId}`),
}
