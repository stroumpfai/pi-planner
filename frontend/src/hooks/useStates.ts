import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { statesApi } from '@/services/states'
import type { ProjectState, StateItemType } from '@/types'

const key = (projectId: string) => ['states', projectId] as const

/** All three State Lists for the project, ordered by item type then position. */
export const useStates = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: key(projectId),
    queryFn: () => statesApi.list(projectId),
    enabled: !!projectId && enabled,
  })

/** The State List for one item type. Empty until an import or the States editor fills it. */
export const useStatesForType = (projectId: string, itemType: StateItemType) => {
  const query = useStates(projectId)
  const states: ProjectState[] = (query.data ?? []).filter((s) => s.item_type === itemType)
  return { ...query, states }
}

export const useCreateState = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { item_type: StateItemType; value: string }) =>
      statesApi.create(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useRenameState = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stateId, value }: { stateId: string; value: string }) =>
      statesApi.update(projectId, stateId, { value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(projectId) })
      // Items carry the State's value for display, so a rename changes what they show.
      qc.invalidateQueries({ queryKey: ['features', projectId] })
      qc.invalidateQueries({ queryKey: ['pbis', projectId] })
    },
  })
}

export const useReorderStates = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { item_type: StateItemType; order: string[] }) =>
      statesApi.reorder(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}

export const useDeleteState = (projectId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stateId: string) => statesApi.delete(projectId, stateId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  })
}
