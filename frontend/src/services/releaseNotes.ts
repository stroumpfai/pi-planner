import { api } from './api'
import type { ReleaseNotes } from '@/types'

export const releaseNotesApi = {
  list: () => api.get<ReleaseNotes>('/release-notes').then((r) => r.data),
}
