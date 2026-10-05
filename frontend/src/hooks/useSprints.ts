import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { sprintsApi } from '@/services/sprints'
import type { PI, SprintUpdate } from '@/types'

const key = (piId: string) => ['sprints', piId] as const

export const useSprints = (piId: string) =>
  useQuery({
    queryKey: key(piId),
    queryFn: () => sprintsApi.list(piId),
    enabled: !!piId,
  })

/**
 * Whether any PI of these, or any of their sprints, has an iteration path — i.e.
 * whether a CSV Iteration Path could place anything at all. A sprint path alone
 * is enough, so the PIs' own paths cannot answer this. `undefined` until it is
 * known, so a caller never warns on a question still loading.
 */
export const useAnyIterationPath = (pis: readonly PI[]): boolean | undefined => {
  const unmapped = pis.filter((p) => !p.iteration_path)
  const sprints = useQueries({
    queries: unmapped.map((p) => ({
      queryKey: key(p.system_id),
      queryFn: () => sprintsApi.list(p.system_id),
    })),
  })
  if (unmapped.length < pis.length) return true
  if (sprints.some((q) => q.data?.some((s) => s.iteration_path))) return true
  if (sprints.some((q) => q.data === undefined)) return undefined
  return false
}

export const useUpdateSprint = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sprintId, body }: { sprintId: string; body: SprintUpdate }) =>
      sprintsApi.update(sprintId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(piId) })
      qc.invalidateQueries({ queryKey: ['swimlines'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
    },
  })
}
