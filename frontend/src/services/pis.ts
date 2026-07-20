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

export type ExportPNGLayout = 'roadmap' | 'list' | 'heatmap'

export interface ExportPNGOptions {
  layout: ExportPNGLayout
  showPiEffort: boolean
  showSprintEffort: boolean
  showSwimlaneEffort: boolean
  showEvents: boolean
  swimlaneTextCenter: boolean
  showExportDate: boolean
  splitBySwimline: boolean
  showId: boolean
}

export const DEFAULT_EXPORT_PNG_OPTIONS: ExportPNGOptions = {
  layout: 'roadmap',
  showPiEffort: false,
  showSprintEffort: false,
  showSwimlaneEffort: false,
  showEvents: false,
  swimlaneTextCenter: false,
  showExportDate: false,
  splitBySwimline: false,
  showId: false,
}

export function downloadPIPNG(piId: string, piName: string, options: ExportPNGOptions): Promise<void> {
  const params = new URLSearchParams({
    layout: options.layout,
    show_pi_effort: String(options.showPiEffort),
    show_sprint_effort: String(options.showSprintEffort),
    show_swimlane_effort: String(options.showSwimlaneEffort),
    show_events: String(options.showEvents),
    swimlane_text_center: String(options.swimlaneTextCenter),
    show_export_date: String(options.showExportDate),
    split_by_swimline: String(options.splitBySwimline),
    show_id: String(options.showId),
  })
  return _downloadBlob(`/api/v1/pis/${piId}/export/png?${params}`, `${piName}.png`)
}

export type ReportType = 'readiness' | 'readout'
export type ReportFormat = 'markdown' | 'pdf'

export interface ReportOptions {
  reportType: ReportType
  format: ReportFormat
  showIds: boolean
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  reportType: 'readiness',
  format: 'markdown',
  showIds: true,
}

export function downloadPIReport(piId: string, piName: string, options: ReportOptions): Promise<void> {
  const params = new URLSearchParams({
    report_type: options.reportType,
    fmt: options.format,
    show_ids: String(options.showIds),
  })
  const ext = options.format === 'pdf' ? 'pdf' : 'md'
  return _downloadBlob(
    `/api/v1/pis/${piId}/report?${params}`,
    `${piName}-${options.reportType}.${ext}`,
  )
}
