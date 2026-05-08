import { useMutation, useQueryClient } from '@tanstack/react-query'
import { csvImportApi } from '@/services/csvImport'
import type { CsvImportRequest } from '@/types'

export const useCsvImport = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CsvImportRequest) => csvImportApi.execute(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['features', projectId] }),
  })
}
