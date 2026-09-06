import { api, errorDetail } from './api'
import type {
  ProjectPushResult,
  ProjectPushStatus,
  PushPreview,
  TeamPushResponse,
} from '@/types'

/**
 * Getting a team's number onto the board — review, then apply (teams.md §6.7).
 *
 * The two project-scoped calls sit behind the same edit lock every other project
 * write does, so a 409 carrying `locked_by` is handled by the shared interceptor
 * and needs nothing here. What *does* need naming is the business 409s: a manual
 * project and a derived Available are refusals with a fix the UI can describe.
 */

export type PushErrorCode =
  | 'AVAILABLE_SOURCE_IS_MANUAL'
  | 'AVAILABLE_IS_DERIVED'
  | 'PROJECT_HAS_NO_TEAM'
  | 'SPRINT_DATES_MISALIGNED'

export function pushErrorCode(err: unknown): PushErrorCode | null {
  const detail = errorDetail(err)
  switch (detail?.error) {
    case 'AVAILABLE_SOURCE_IS_MANUAL':
    case 'AVAILABLE_IS_DERIVED':
    case 'PROJECT_HAS_NO_TEAM':
    case 'SPRINT_DATES_MISALIGNED':
      return detail.error
    default:
      return null
  }
}

/** The human-readable half of a business 409, for showing beside the row it broke. */
export function pushErrorMessage(err: unknown): string | null {
  return errorDetail(err)?.message ?? null
}

export const teamPushApi = {
  /** What a push would write. Writes nothing — this is the review step. */
  preview: (projectId: string) =>
    api.get<PushPreview>(`/projects/${projectId}/team-capacity/preview`).then((r) => r.data),

  /** Write the proposed values. Idempotent: an unchanged push writes nothing. */
  apply: (projectId: string) =>
    api
      .post<ProjectPushResult>(`/projects/${projectId}/team-capacity/apply`)
      .then((r) => r.data),

  /** Every project the team serves, per project and **not atomic** (§6.7). */
  pushTeam: (teamId: string) =>
    api.post<TeamPushResponse>(`/teams/${teamId}/push`).then((r) => r.data),

  /**
   * How far each served project has drifted from its team (§6.6).
   *
   * Available to any authenticated user, readers included: staleness is
   * information, not an action.
   */
  status: (projectId?: string) =>
    api
      .get<ProjectPushStatus[]>('/team-capacity/status', {
        params: projectId ? { project_id: projectId } : undefined,
      })
      .then((r) => r.data),
}
