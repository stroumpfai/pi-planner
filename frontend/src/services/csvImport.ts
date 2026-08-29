import { api } from './api'
import type { CsvImportRequest, CsvImportResult } from '@/types'

export const csvImportApi = {
  execute: (projectId: string, body: CsvImportRequest) =>
    api.post<CsvImportResult>(`/projects/${projectId}/import/csv`, body).then((r) => r.data),

  /** Run the import and roll it back, to see the plan it would carry out. */
  dryRun: (projectId: string, body: CsvImportRequest) =>
    api
      .post<CsvImportResult>(`/projects/${projectId}/import/csv?dry_run=true`, body)
      .then((r) => r.data),
}
