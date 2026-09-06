import { api, errorDetail, type ApiErrorDetail } from './api'
import type {
  PatternVersion,
  PatternVersionCreate,
  PatternVersionUpdate,
  TeamMember,
  TeamMemberCreate,
  TeamMemberUpdate,
} from '@/types'

/**
 * Members and their dated working patterns (teams.md §3.2, §3.3).
 *
 * **The ETag rides in the body here, not in a header.** Teams are read one at a
 * time, so their tag fits in the response's `ETag`; members are read as a list,
 * and a header can only describe one row. Each member and each version therefore
 * carries its own `etag` field, which is the baseline a later write quotes back —
 * and it belongs to the values the user is looking at, which is the whole point
 * of the precondition (§4.2).
 */

const membersUrl = (teamId: string) => `/teams/${teamId}/members`
const memberUrl = (teamId: string, memberId: string) => `${membersUrl(teamId)}/${memberId}`
const versionsUrl = (teamId: string, memberId: string) =>
  `${memberUrl(teamId, memberId)}/working-days`

interface StaleDetail<T> extends ApiErrorDetail {
  error: 'STALE'
  current: T
}

/**
 * The failures a member or pattern write can report that mean something here.
 *
 * `STALE` (412) stays distinct from the lock's 409 for the same reason it does in
 * `teams.ts`: the lock means *someone else is editing this project*, 412 means
 * *this row moved under you* (§4.2).
 */
export type MemberErrorCode =
  | 'MEMBER_NAME_TAKEN'
  | 'MEMBER_LIMIT_REACHED'
  | 'PATTERN_VERSION_LIMIT_REACHED'
  | 'PATTERN_VERSION_DATE_TAKEN'
  | 'EARLIEST_VERSION_NOT_DELETABLE'
  | 'INVALID_VALIDITY'
  | 'STALE'
  | 'IF_MATCH_REQUIRED'

export function memberErrorCode(err: unknown): MemberErrorCode | null {
  const detail = errorDetail(err)
  switch (detail?.error) {
    case 'MEMBER_NAME_TAKEN':
    case 'MEMBER_LIMIT_REACHED':
    case 'PATTERN_VERSION_LIMIT_REACHED':
    case 'PATTERN_VERSION_DATE_TAKEN':
    case 'EARLIEST_VERSION_NOT_DELETABLE':
    case 'INVALID_VALIDITY':
    case 'STALE':
    case 'IF_MATCH_REQUIRED':
      return detail.error
    default:
      return null
  }
}

/** The row as it now stands, carried by a 412 so the client can show what moved. */
export function staleRow<T>(err: unknown): T | null {
  const detail = errorDetail<StaleDetail<T>>(err)
  return detail?.error === 'STALE' ? detail.current : null
}

/** What a 412 means in words the user can act on, as `teams.ts` does for a team. */
export const MEMBER_CHANGED_MESSAGE =
  'This member changed while you had them open — the list has been refreshed. Check the current values and try again.'

const ifMatch = (etag: string) => ({ headers: { 'If-Match': etag } })

export const teamMembersApi = {
  /**
   * A team's members, each carrying the pattern in force on *asOf*.
   *
   * The date is what lets one endpoint serve both views: Members reads today's
   * hours and focus, Working days reads whatever the picker names (§7.2, §7.3).
   */
  list: (teamId: string, asOf?: string) =>
    api
      .get<TeamMember[]>(membersUrl(teamId), asOf ? { params: { as_of: asOf } } : undefined)
      .then((r) => r.data),

  create: (teamId: string, body: TeamMemberCreate) =>
    api.post<TeamMember>(membersUrl(teamId), body).then((r) => r.data),

  update: (teamId: string, memberId: string, body: TeamMemberUpdate, etag: string) =>
    api.patch<TeamMember>(memberUrl(teamId, memberId), body, ifMatch(etag)).then((r) => r.data),

  delete: (teamId: string, memberId: string, etag: string) =>
    api.delete(memberUrl(teamId, memberId), ifMatch(etag)),

  // No If-Match: an order carries none of the values a stale write would
  // overwrite, and the server ignores ids that are not on the team.
  reorder: (teamId: string, order: string[]) =>
    api.post<TeamMember[]>(`${membersUrl(teamId)}/reorder`, { order }).then((r) => r.data),

  versions: (teamId: string, memberId: string) =>
    api.get<PatternVersion[]>(versionsUrl(teamId, memberId)).then((r) => r.data),

  /**
   * Add a version, or replace the one already on that date.
   *
   * The body is the whole pattern, because posting onto an existing
   * `effective_from` edits that version rather than creating a duplicate (§3.3).
   * That branch is an overwrite, so pass the existing version's `etag`: without
   * it the server answers 428, and against a stale one 412, exactly as
   * `updateVersion` does. Omit it only when the date is genuinely free — there is
   * no ETag to quote for a version that does not exist yet.
   */
  addVersion: (
    teamId: string,
    memberId: string,
    body: PatternVersionCreate,
    etag?: string,
  ) =>
    api
      .post<PatternVersion>(versionsUrl(teamId, memberId), body, etag ? ifMatch(etag) : undefined)
      .then((r) => r.data),

  updateVersion: (
    teamId: string,
    memberId: string,
    versionId: string,
    body: PatternVersionUpdate,
    etag: string,
  ) =>
    api
      .patch<PatternVersion>(`${versionsUrl(teamId, memberId)}/${versionId}`, body, ifMatch(etag))
      .then((r) => r.data),

  deleteVersion: (teamId: string, memberId: string, versionId: string, etag: string) =>
    api.delete(`${versionsUrl(teamId, memberId)}/${versionId}`, ifMatch(etag)),
}
