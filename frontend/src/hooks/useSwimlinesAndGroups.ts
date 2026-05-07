import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { swimlinesApi } from '@/services/swimlines'
import { groupsApi } from '@/services/groups'
import type { SwimlineCreate, SwimlineUpdate, GroupCreate, GroupUpdate } from '@/types'

// --- Swimlines ---

const swimlineKey = (piId: string) => ['swimlines', piId] as const

export const useSwimlinesForPI = (piId: string) =>
  useQuery({
    queryKey: swimlineKey(piId),
    queryFn: () => swimlinesApi.list(piId),
    enabled: !!piId,
  })

export const useCreateSwimline = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SwimlineCreate) => swimlinesApi.create(piId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: swimlineKey(piId) }),
  })
}

export const useUpdateSwimline = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ swimlineId, body }: { swimlineId: string; body: SwimlineUpdate }) =>
      swimlinesApi.update(swimlineId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: swimlineKey(piId) }),
  })
}

export const useDeleteSwimline = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (swimlineId: string) => swimlinesApi.delete(swimlineId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: swimlineKey(piId) })
      qc.invalidateQueries({ queryKey: ['features'] })
      qc.invalidateQueries({ queryKey: ['pis'] })
    },
  })
}

export const useReorderSwimlines = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ swimlineId, order }: { swimlineId: string; order: string[] }) =>
      swimlinesApi.reorder(swimlineId, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: swimlineKey(piId) }),
  })
}

// --- Groups ---

const groupKey = (swimlineId: string) => ['groups', swimlineId] as const

export const useGroupsForSwimline = (swimlineId: string) =>
  useQuery({
    queryKey: groupKey(swimlineId),
    queryFn: () => groupsApi.list(swimlineId),
    enabled: !!swimlineId,
  })

function invalidateEffectCaches(qc: ReturnType<typeof useQueryClient>, swimlineId: string): void {
  qc.invalidateQueries({ queryKey: groupKey(swimlineId) })
  qc.invalidateQueries({ queryKey: ['pbis'] })
  qc.invalidateQueries({ queryKey: ['sprints'] })
  qc.invalidateQueries({ queryKey: ['swimlines'] })
  qc.invalidateQueries({ queryKey: ['pis'] })
}

export const useCreateGroup = (swimlineId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GroupCreate) => groupsApi.create(swimlineId, body),
    onSuccess: () => invalidateEffectCaches(qc, swimlineId),
  })
}

export const useUpdateGroup = (swimlineId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, body }: { groupId: string; body: GroupUpdate }) =>
      groupsApi.update(groupId, body),
    onSuccess: () => invalidateEffectCaches(qc, swimlineId),
  })
}

export const useDeleteGroup = (swimlineId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (groupId: string) => groupsApi.delete(groupId),
    onSuccess: () => invalidateEffectCaches(qc, swimlineId),
  })
}
