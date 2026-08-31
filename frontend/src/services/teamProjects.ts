import { api, errorDetail, type ApiErrorDetail } from './api'
import type {
  TeamAssignment,
  TeamAssignmentCreate,
  TeamAssignmentUpdate,
  TeamCapacity,
} from '@/types'

/**
 * Which projects a team serves, and the capacity it has for them (teams.md §6, §7.6).
 *
 * As with members, each assignment carries its own `etag` in the body: the
 * Projects tab reads them as a list, and a header can only describe one row (§4.2).
 */

const projectsUrl = (teamId: string) => `/teams/${teamId}/projects`

interface StaleDetail extends ApiErrorDetail {
  error: 'STALE'
  current: TeamAssignment
}

export type AssignmentErrorCode =
  | 'PROJECT_ALREADY_ASSIGNED'
  | 'PROJECT_LIMIT_REACHED'
  | 'STALE'
  | 'IF_MATCH_REQUIRED'

export function assignmentErrorCode(err: unknown): AssignmentErrorCode | null {
  const detail = errorDetail(err)
  switch (detail?.error) {
    case 'PROJECT_ALREADY_ASSIGNED':
    case 'PROJECT_LIMIT_REACHED':
    case 'STALE':
    case 'IF_MATCH_REQUIRED':
      return detail.error
    default:
      return null
  }
}

export function staleAssignment(err: unknown): TeamAssignment | null {
  const detail = errorDetail<StaleDetail>(err)
  return detail?.error === 'STALE' ? detail.current : null
}

const ifMatch = (etag: string) => ({ headers: { 'If-Match': etag } })

export const teamProjectsApi = {
  /** Anchor first: the earliest assignment defines the team's sprint calendar (§6.8). */
  list: (teamId: string) => api.get<TeamAssignment[]>(projectsUrl(teamId)).then((r) => r.data),

  assign: (teamId: string, body: TeamAssignmentCreate) =>
    api.post<TeamAssignment>(projectsUrl(teamId), body).then((r) => r.data),

  update: (teamId: string, projectId: string, body: TeamAssignmentUpdate, etag: string) =>
    api
      .patch<TeamAssignment>(`${projectsUrl(teamId)}/${projectId}`, body, ifMatch(etag))
      .then((r) => r.data),

  /** Unassign. Writes nothing to the project: Available stays as last pushed (§6.1). */
  unassign: (teamId: string, projectId: string, etag: string) =>
    api.delete(`${projectsUrl(teamId)}/${projectId}`, ifMatch(etag)),

  capacity: (teamId: string, from?: string, to?: string) =>
    api
      .get<TeamCapacity>(`/teams/${teamId}/capacity`, {
        params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      })
      .then((r) => r.data),
}
