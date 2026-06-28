import { api } from './api'
import type { PIEvent, PIEventCreate, PIEventUpdate } from '@/types'

export const piEventsApi = {
  list: (piId: string) =>
    api.get<PIEvent[]>(`/pis/${piId}/events`).then((r) => r.data),

  create: (piId: string, body: PIEventCreate) =>
    api.post<PIEvent>(`/pis/${piId}/events`, body).then((r) => r.data),

  update: (piId: string, eventId: string, body: PIEventUpdate) =>
    api.patch<PIEvent>(`/pis/${piId}/events/${eventId}`, body).then((r) => r.data),

  delete: (piId: string, eventId: string) =>
    api.delete(`/pis/${piId}/events/${eventId}`),
}
