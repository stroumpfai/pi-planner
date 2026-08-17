import { useMutation, useQueryClient } from '@tanstack/react-query'
import { csvImportApi } from '@/services/csvImport'
import type { CsvImportRequest } from '@/types'

export const useCsvImport = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CsvImportRequest) => csvImportApi.execute(projectId, body),
    // Import can create/update/remove items; removals may free PBIs from groups,
    // sprints and PIs, so invalidate the full related set (mirrors invalidatePBIRelated).
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['sprints'] })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
    },
  })
}
