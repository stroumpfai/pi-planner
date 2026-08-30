import { api, errorDetail, etagOf, type ApiErrorDetail } from './api'
import type { Team, TeamCreate, TeamUpdate } from '@/types'

/** A team read together with the `ETag` a later write has to quote (teams.md §4.2). */
export interface TeamRead {
  readonly team: Team
  readonly etag: string
}

/** A project that is blocking a team's deletion, as the 409 names it. */
export interface BlockingProject {
  readonly system_id: string
  readonly name: string
}

interface TeamHasProjectsDetail extends ApiErrorDetail {
  error: 'TEAM_HAS_PROJECTS'
  projects: BlockingProject[]
}

interface StaleDetail extends ApiErrorDetail {
  error: 'STALE'
  current: Team
}

/**
 * The failures a team write can report that mean something to the user.
 *
 * `STALE` (412) is deliberately separate from the lock's 409: the lock means
 * *someone else is editing this project, wait*, while 412 means *this row moved
 * under you*. Collapsing them would leave the UI guessing (§4.2).
 */
export type TeamErrorCode =
  | 'TEAM_NAME_TAKEN'
  | 'TEAM_LIMIT_REACHED'
  | 'TEAM_HAS_PROJECTS'
  | 'STALE'
  | 'IF_MATCH_REQUIRED'

export function teamErrorCode(err: unknown): TeamErrorCode | null {
  const detail = errorDetail(err)
  switch (detail?.error) {
    case 'TEAM_NAME_TAKEN':
    case 'TEAM_LIMIT_REACHED':
    case 'TEAM_HAS_PROJECTS':
    case 'STALE':
    case 'IF_MATCH_REQUIRED':
      return detail.error
    default:
      return null
  }
}

/**
 * The projects a blocked delete named, so the UI can list them.
 *
 * "Unassign every project first" is useless without them (§10).
 */
export function blockingProjects(err: unknown): BlockingProject[] {
  const detail = errorDetail<TeamHasProjectsDetail>(err)
  return detail?.error === 'TEAM_HAS_PROJECTS' && Array.isArray(detail.projects)
    ? detail.projects
    : []
}

/** The team as it now stands, carried by the 412 so the client can show what changed. */
export function staleTeam(err: unknown): Team | null {
  const detail = errorDetail<StaleDetail>(err)
  return detail?.error === 'STALE' ? detail.current : null
}

/**
 * What a 412 means in words the user can act on.
 *
 * Step 5 (WP-5F) replaces this with the keep-theirs / reapply-mine banner. Until
 * then the write still must not vanish into a spinner or a silent refetch, so it
 * says plainly that the row moved and that what is on screen is now current.
 */
export const TEAM_CHANGED_MESSAGE =
  'This team changed while you had it open — the list has been refreshed. Check the current values and try again.'

export const teamsApi = {
  list: () => api.get<Team[]>('/teams').then((r) => r.data),

  get: (teamId: string): Promise<TeamRead> =>
    api.get<Team>(`/teams/${teamId}`).then((r) => ({ team: r.data, etag: etagOf(r) })),

  create: (body: TeamCreate) => api.post<Team>('/teams', body).then((r) => r.data),

  // The write echoes a fresh ETag, so a caller holding a form open can keep editing
  // without a second read.
  update: (teamId: string, body: TeamUpdate, etag: string): Promise<TeamRead> =>
    api
      .patch<Team>(`/teams/${teamId}`, body, { headers: { 'If-Match': etag } })
      .then((r) => ({ team: r.data, etag: etagOf(r) })),

  delete: (teamId: string, etag: string) =>
    api.delete(`/teams/${teamId}`, { headers: { 'If-Match': etag } }),
}
