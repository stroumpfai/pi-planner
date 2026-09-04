import { api, errorDetail, type ApiErrorDetail } from './api'
import type { Meeting, MeetingCreate, MeetingUpdate } from '@/types'

/**
 * Booked time, and who is in it (teams.md §3.5, §7.5).
 *
 * **A create writes one row, not one per person.** This is the difference from
 * `absences.ts` worth holding on to: an absence fans a rule out into one record
 * per member, because everybody's Christmas is separately correctable; a meeting
 * is a shared event with one schedule, and the thing that changes week to week is
 * the attendee set. That is what makes the view a matrix — a meeting is a column,
 * attendance is a cell.
 *
 * **Attendance is a PATCH of the meeting.** Ticking a cell sends the whole
 * `member_ids` set with the meeting's `If-Match`, so two people ticking different
 * cells of the same column collide — correctly, since they are editing one row.
 * Omitting `member_ids` leaves attendance untouched.
 *
 * **Occurrences come from the server**, inside the window a read names, for the
 * same reason absences do: expanding a recurrence here would be a second
 * implementation of the backend's generator, free to disagree with the one the
 * capacity figures come from.
 */

const meetingsUrl = (teamId: string) => `/teams/${teamId}/meetings`

interface StaleDetail extends ApiErrorDetail {
  error: 'STALE'
  current: Meeting
}

export type MeetingErrorCode =
  | 'MEETING_LIMIT_REACHED'
  | 'INVALID_SCHEDULE'
  | 'MEMBER_NOT_FOUND'
  | 'STALE'
  | 'IF_MATCH_REQUIRED'

export function meetingErrorCode(err: unknown): MeetingErrorCode | null {
  const detail = errorDetail(err)
  switch (detail?.error) {
    case 'MEETING_LIMIT_REACHED':
    case 'INVALID_SCHEDULE':
    case 'MEMBER_NOT_FOUND':
    case 'STALE':
    case 'IF_MATCH_REQUIRED':
      return detail.error
    default:
      return null
  }
}

/** The row as it now stands, carried by a 412 so the banner can show what moved. */
export function staleMeeting(err: unknown): Meeting | null {
  const detail = errorDetail<StaleDetail>(err)
  return detail?.error === 'STALE' ? detail.current : null
}

/**
 * The attendee set, always a list.
 *
 * `member_ids` and `occurrences` are optional on the wire because both have
 * server-side defaults, and every reader here wants an array rather than a
 * branch. One helper, so a missing field cannot mean "nobody" in one place and
 * throw in another.
 */
export const attendeesOf = (meeting: Meeting): readonly string[] => meeting.member_ids ?? []

/** The days this meeting falls on inside the window that was read. */
export const occurrencesOf = (meeting: Meeting): readonly string[] => meeting.occurrences ?? []

const ifMatch = (etag: string) => ({ headers: { 'If-Match': etag } })

const window = (from: string, to: string) => ({ params: { from, to } })

export const meetingsApi = {
  /**
   * Every meeting the team holds, with its occurrences inside `[from, to]`.
   *
   * The rules are never filtered — only the expansion is windowed. A meeting
   * with no occurrence in the selected sprint keeps its column and contributes
   * nothing, rather than vanishing from a matrix whose other columns did not
   * move (§7.5).
   */
  list: (teamId: string, from: string, to: string) =>
    api.get<Meeting[]>(meetingsUrl(teamId), window(from, to)).then((r) => r.data),

  /** One meeting with its attendees. No If-Match: a create cannot clobber. */
  create: (teamId: string, body: MeetingCreate, from: string, to: string) =>
    api.post<Meeting>(meetingsUrl(teamId), body, window(from, to)).then((r) => r.data),

  /** Edits the **whole series**, and the attendee set when `member_ids` is sent. */
  update: (
    teamId: string,
    meetingId: string,
    body: MeetingUpdate,
    etag: string,
    from: string,
    to: string,
  ) =>
    api
      .patch<Meeting>(`${meetingsUrl(teamId)}/${meetingId}`, body, {
        ...ifMatch(etag),
        ...window(from, to),
      })
      .then((r) => r.data),

  delete: (teamId: string, meetingId: string, etag: string) =>
    api.delete(`${meetingsUrl(teamId)}/${meetingId}`, ifMatch(etag)),

  /**
   * Column order, as a list of ids.
   *
   * No ETag: order is not a field anyone edits in a form, and a reorder carries
   * none of the values a stale write would overwrite.
   */
  reorder: (teamId: string, order: readonly string[], from: string, to: string) =>
    api
      .post<Meeting[]>(`${meetingsUrl(teamId)}/reorder`, { order }, window(from, to))
      .then((r) => r.data),
}
