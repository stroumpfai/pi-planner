import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { meetingErrorCode, meetingsApi } from '@/services/meetings'
import type { MeetingCreate, MeetingUpdate } from '@/types'

/**
 * Meetings are keyed by team **and by window**, because the window is part of the
 * answer: the same weekly rule yields four occurrence dates for one sprint and
 * five for the next, and the matrix's load column counts them.
 */
const meetingsKey = (teamId: string, from: string, to: string) =>
  ['meetings', teamId, from, to] as const

/**
 * A meeting write moves the capacity figures, so both caches go together.
 *
 * That is the point of the step — an hour booked here has to come off the
 * Capacity view's number — and nothing else recomputes it: capacity is derived on
 * read, never stored (§5.1). Attendance counts too: ticking a cell changes who
 * pays for the meeting.
 */
function invalidate(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  qc.invalidateQueries({ queryKey: ['meetings', teamId] })
  qc.invalidateQueries({ queryKey: ['teamCapacity', teamId] })
}

/**
 * Refresh after a write, and after a 412 as well.
 *
 * A stale write is the one failure that changes what the user should be looking
 * at — the row they were editing has moved — so the refetch here is what lets the
 * banner honestly offer *keep theirs* against a matrix that already shows theirs.
 */
function refreshOnSettled(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  return {
    onSuccess: () => invalidate(qc, teamId),
    onError: (err: unknown) => {
      if (meetingErrorCode(err) === 'STALE') invalidate(qc, teamId)
    },
  }
}

export const useMeetings = (teamId: string, from: string, to: string) =>
  useQuery({
    queryKey: meetingsKey(teamId, from, to),
    queryFn: () => meetingsApi.list(teamId, from, to),
    enabled: teamId !== '',
    // Changing the sprint changes the window, and therefore the key. Without
    // this the matrix would blank on every step through the sprint pager — but
    // attendance is not what the window governs: only the occurrence counts
    // behind the totals are. So the previous answer stays on screen until the
    // new one lands, and the columns never flicker (§7.5).
    placeholderData: (previous) => previous,
  })

export const useCreateMeeting = (teamId: string, from: string, to: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MeetingCreate) => meetingsApi.create(teamId, body, from, to),
    onSuccess: () => invalidate(qc, teamId),
  })
}

/**
 * Update against the baseline the caller was shown.
 *
 * The ETag comes from the row on screen, never from a read taken here: fetching a
 * fresh tag immediately before the write would make the precondition vacuous, and
 * an edit made while the dialog sat open would sail through and silently revert
 * whoever wrote in the meantime (§4.2).
 */
export const useUpdateMeeting = (teamId: string, from: string, to: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      meetingId,
      body,
      etag,
    }: {
      meetingId: string
      body: MeetingUpdate
      etag: string
    }) => meetingsApi.update(teamId, meetingId, body, etag, from, to),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useDeleteMeeting = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ meetingId, etag }: { meetingId: string; etag: string }) =>
      meetingsApi.delete(teamId, meetingId, etag),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useReorderMeetings = (teamId: string, from: string, to: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: readonly string[]) => meetingsApi.reorder(teamId, order, from, to),
    onSuccess: () => invalidate(qc, teamId),
  })
}
