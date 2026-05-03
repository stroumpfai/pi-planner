import { api } from './api'
import type { LoginRequest, TokenResponse, User } from '@/types'

export const authApi = {
  login: (body: LoginRequest) =>
    api.post<TokenResponse>('/auth/login', body).then((r) => r.data),

  logout: () =>
    api.post('/auth/logout'),

  me: () =>
    api.get<User>('/auth/me').then((r) => r.data),
}
