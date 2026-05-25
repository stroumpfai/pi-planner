import { api } from './api'
import type { ChangePassword, PasswordReset, User, UserCreate, UserUpdate } from '@/types'

export const usersApi = {
  list: () =>
    api.get<User[]>('/users/').then((r) => r.data),

  create: (body: UserCreate) =>
    api.post<User>('/users/', body).then((r) => r.data),

  update: (username: string, body: UserUpdate) =>
    api.put<User>(`/users/${username}`, body).then((r) => r.data),

  delete: (username: string) =>
    api.delete(`/users/${username}`),

  resetPassword: (username: string, body: PasswordReset) =>
    api.post(`/users/${username}/reset-password`, body),

  changePassword: (body: ChangePassword) =>
    api.post('/auth/change-password', body),
}
