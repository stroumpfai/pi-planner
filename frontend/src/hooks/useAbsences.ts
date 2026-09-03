import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { absenceErrorCode, absencesApi } from '@/services/absences'
import type { AbsenceCreate, AbsenceUpdate } from '@/types'

/**
 * Absences are keyed by team **and by window**, because the window is part of
 * the answer: the same rule returns different occurrences for September than for
 * December, and two readers on screen at once want different spans.
 */
const absencesKey = (teamId: string, from: string, to: string) =>
  ['absences', teamId, from, to] as const

/**
 * An absence write moves the capacity figures, so both caches go together.
 *
 * That is the point of the whole step — a holiday entered here has to make the
 * Capacity view's number drop — and nothing else recomputes it: capacity is
 * derived on read, never stored (§5.1).
 */
function invalidate(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  qc.invalidateQueries({ queryKey: ['absences', teamId] })
  qc.invalidateQueries({ queryKey: ['teamCapacity', teamId] })
}

/**
 * Refresh after a write, and after a 412 as well.
 *
 * A stale write is the one failure that changes what the user should be looking
 * at — the row they were editing has moved — so the refetch here is what lets the
 * banner honestly offer *keep theirs* against a list that already shows theirs.
 */
function refreshOnSettled(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  return {
    onSuccess: () => invalidate(qc, teamId),
    onError: (err: unknown) => {
      if (absenceErrorCode(err) === 'STALE') invalidate(qc, teamId)
    },
  }
}

export const useAbsences = (teamId: string, from: string, to: string) =>
  useQuery({
    queryKey: absencesKey(teamId, from, to),
    queryFn: () => absencesApi.list(teamId, from, to),
    enabled: teamId !== '',
  })

export const useCreateAbsences = (teamId: string, from: string, to: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AbsenceCreate) => absencesApi.create(teamId, body, from, to),
    onSuccess: () => invalidate(qc, teamId),
  })
}

/**
 * Update against the baseline the caller was shown.
 *
 * The ETag comes from the row on screen, never from a read taken here: fetching
 * a fresh tag immediately before the write would make the precondition vacuous,
 * and an edit made while the dialog sat open would sail through and silently
 * revert whoever wrote in the meantime (§4.2).
 */
export const useUpdateAbsence = (teamId: string, from: string, to: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      absenceId,
      body,
      etag,
    }: {
      absenceId: string
      body: AbsenceUpdate
      etag: string
    }) => absencesApi.update(teamId, absenceId, body, etag, from, to),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useDeleteAbsence = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ absenceId, etag }: { absenceId: string; etag: string }) =>
      absencesApi.delete(teamId, absenceId, etag),
    ...refreshOnSettled(qc, teamId),
  })
}
