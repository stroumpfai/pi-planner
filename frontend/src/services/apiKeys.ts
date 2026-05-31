import { api } from './api'
import type { ApiKey, ApiKeyCreate, ApiKeyCreateResponse } from '@/types'

export const apiKeysApi = {
  listAll: () =>
    api.get<ApiKey[]>('/api-keys/admin/all-keys').then((r) => r.data),

  create: (body: ApiKeyCreate) =>
    api.post<ApiKeyCreateResponse>('/api-keys/admin/keys', body).then((r) => r.data),

  cycle: (keyId: string) =>
    api.post<ApiKeyCreateResponse>(`/api-keys/admin/cycle/${keyId}`).then((r) => r.data),

  revoke: (keyId: string) =>
    api.delete(`/api-keys/admin/keys/${keyId}`),
}
