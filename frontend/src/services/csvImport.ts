import { api } from './api'
import type { CsvImportRequest, CsvImportResult } from '@/types'

export const csvImportApi = {
  execute: (projectId: string, body: CsvImportRequest) =>
    api.post<CsvImportResult>(`/projects/${projectId}/import/csv`, body).then((r) => r.data),
}
