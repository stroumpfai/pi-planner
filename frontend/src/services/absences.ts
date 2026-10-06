import { api, errorDetail, type ApiErrorDetail } from './api'
import type {
  Absence,
  AbsenceCreate,
  AbsenceIcsImportResult,
  AbsenceImportSelection,
  AbsenceUpdate,
} from '@/types'

/**
 * When members are not there (teams.md §3.4, §7.4).
 *
 * **A create takes several members and returns several records.** The
 * multi-select is an input convenience, not a shared object: one request writes
 * one absence per person, each independently editable afterwards. That is the
 * whole mechanism for public holidays — enter Christmas once with everyone
 * selected, then correct the one person who is on call.
 *
 * **Occurrences come from the server.** The stored truth is a rule; the grid
 * draws half-days. Expanding a recurrence here would be a second implementation
 * of the backend's generator, free to disagree with the one the capacity figures
 * are computed from — so every read names a window and the server expands inside
 * it.
 *
 * As with members, the ETag rides in each row's body rather than in a header:
 * absences are read as a list, and a header can only describe one row (§4.2).
 */

const absencesUrl = (teamId: string) => `/teams/${teamId}/absences`

interface StaleDetail extends ApiErrorDetail {
  error: 'STALE'
  current: Absence
}

export type AbsenceErrorCode =
  | 'ABSENCE_LIMIT_REACHED'
  | 'INVALID_SCHEDULE'
  | 'MEMBER_NOT_FOUND'
  | 'STALE'
  | 'IF_MATCH_REQUIRED'
  | 'INVALID_ICS'
  | 'ICS_TOO_LARGE'
  | 'TOO_MANY_EVENTS'
  | 'IMPORT_STALE'
  | 'UNKNOWN_EVENT'

export function absenceErrorCode(err: unknown): AbsenceErrorCode | null {
  const detail = errorDetail(err)
  switch (detail?.error) {
    case 'ABSENCE_LIMIT_REACHED':
    case 'INVALID_SCHEDULE':
    case 'MEMBER_NOT_FOUND':
    case 'STALE':
    case 'IF_MATCH_REQUIRED':
    case 'INVALID_ICS':
    case 'ICS_TOO_LARGE':
    case 'TOO_MANY_EVENTS':
    case 'IMPORT_STALE':
    case 'UNKNOWN_EVENT':
      return detail.error
    default:
      return null
  }
}

/** The row as it now stands, carried by a 412 so the banner can show what moved. */
export function staleAbsence(err: unknown): Absence | null {
  const detail = errorDetail<StaleDetail>(err)
  return detail?.error === 'STALE' ? detail.current : null
}

const ifMatch = (etag: string) => ({ headers: { 'If-Match': etag } })

const window = (from: string, to: string) => ({ params: { from, to } })

export interface AbsenceIcsImportOptions {
  readonly dryRun: boolean
  /** The member a personal file belongs to; omit to match events by name. */
  readonly memberId?: string
  readonly windowFrom?: string
  readonly windowTo?: string
  /** Apply only: the ticked rows, each with the member the user settled on. */
  readonly selections?: readonly AbsenceImportSelection[]
  /** Apply only: the proposed removals the user kept ticked. */
  readonly removals?: readonly string[]
}

export const absencesApi = {
  /**
   * Every rule the team holds, with its occurrences inside `[from, to]`.
   *
   * The rules are never filtered — only the expansion is windowed. A rule with
   * no occurrence in view still comes back, because the minimap's density bars
   * are drawn from months the grid is not currently showing (§7.4).
   */
  list: (teamId: string, from: string, to: string) =>
    api.get<Absence[]>(absencesUrl(teamId), window(from, to)).then((r) => r.data),

  /** One rule, one record per member. No If-Match: a create cannot clobber. */
  create: (teamId: string, body: AbsenceCreate, from: string, to: string) =>
    api.post<Absence[]>(absencesUrl(teamId), body, window(from, to)).then((r) => r.data),

  /** Edits the **whole series**. There is no per-occurrence exception (§3.4). */
  update: (
    teamId: string,
    absenceId: string,
    body: AbsenceUpdate,
    etag: string,
    from: string,
    to: string,
  ) =>
    api
      .patch<Absence>(`${absencesUrl(teamId)}/${absenceId}`, body, {
        ...ifMatch(etag),
        ...window(from, to),
      })
      .then((r) => r.data),

  delete: (teamId: string, absenceId: string, etag: string) =>
    api.delete(`${absencesUrl(teamId)}/${absenceId}`, ifMatch(etag)),

  /**
   * Preview or apply an `.ics` import (teams.md §7.4.1).
   *
   * Stateless: the apply sends the file again with what the user ticked, and
   * the server re-reads it and checks each choice against it.
   */
  importIcs: (teamId: string, file: File, options: AbsenceIcsImportOptions) => {
    const form = new FormData()
    form.append('file', file)
    if (options.selections) form.append('selections', JSON.stringify(options.selections))
    if (options.removals) form.append('removals', JSON.stringify(options.removals))
    return api
      .post<AbsenceIcsImportResult>(`${absencesUrl(teamId)}/import/ics`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params: {
          dry_run: options.dryRun,
          member_id: options.memberId,
          window_from: options.windowFrom,
          window_to: options.windowTo,
        },
      })
      .then((r) => r.data)
  },
}
