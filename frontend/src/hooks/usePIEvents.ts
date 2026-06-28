import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { piEventsApi } from '@/services/piEvents'
import type { PIEventCreate, PIEventUpdate } from '@/types'

const key = (piId: string) => ['pi-events', piId] as const

export const usePIEvents = (piId: string) =>
  useQuery({
    queryKey: key(piId),
    queryFn: () => piEventsApi.list(piId),
    enabled: !!piId,
  })

export const useCreatePIEvent = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PIEventCreate) => piEventsApi.create(piId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(piId) }),
  })
}

export const useUpdatePIEvent = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ eventId, body }: { eventId: string; body: PIEventUpdate }) =>
      piEventsApi.update(piId, eventId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(piId) }),
  })
}

export const useDeletePIEvent = (piId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (eventId: string) => piEventsApi.delete(piId, eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(piId) }),
  })
}
