import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sprintsApi } from '@/services/sprints'
import type { SprintUpdate } from '@/types'

const key = (piId: string) => ['sprints', piId] as const

export const useSprints = (piId: string) =>
  useQuery({
    queryKey: key(piId),
    queryFn: () => sprintsApi.list(piId),
    enabled: !!piId,
  })

export const useUpdateSprint = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sprintId, body }: { sprintId: string; body: SprintUpdate }) =>
      sprintsApi.update(sprintId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(piId) }),
  })
}
