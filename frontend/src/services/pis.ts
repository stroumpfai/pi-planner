import { api } from './api'
import type { PI, PICreate, PIUpdate } from '@/types'

export const pisApi = {
  list: (projectId: string) =>
    api.get<PI[]>(`/projects/${projectId}/pis`).then((r) => r.data),

  get: (piId: string) =>
    api.get<PI>(`/pis/${piId}`).then((r) => r.data),

  create: (projectId: string, body: PICreate) =>
    api.post<PI>(`/projects/${projectId}/pis`, body).then((r) => r.data),

  update: (piId: string, body: PIUpdate) =>
    api.patch<PI>(`/pis/${piId}`, body).then((r) => r.data),

  delete: (piId: string) =>
    api.delete(`/pis/${piId}`),
}

async function _downloadBlob(url: string, fallbackName: string): Promise<void> {
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`Export failed: ${resp.status}`)
  const blob = await resp.blob()
  const disposition = resp.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const filename = match?.[1] ?? fallbackName
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.click()
  URL.revokeObjectURL(href)
}

export function downloadPICSV(piId: string, piName: string): Promise<void> {
  return _downloadBlob(`/api/v1/pis/${piId}/export/csv`, `${piName}.csv`)
}

export function downloadPIPNG(piId: string, piName: string): Promise<void> {
  return _downloadBlob(`/api/v1/pis/${piId}/export/png`, `${piName}.png`)
}
