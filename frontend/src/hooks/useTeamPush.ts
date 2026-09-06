import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { teamPushApi } from '@/services/teamPush'
import type { ProjectPushStatus, PushPreview } from '@/types'

const statusKey = (projectId?: string) => ['teamCapacityStatus', projectId ?? 'all'] as const
const previewKey = (projectId: string) => ['teamCapacityPreview', projectId] as const

/**
 * The push, and the staleness it exists to resolve (teams.md §6.6, §6.7).
 *
 * A push writes sprint Available, so **everything that reads a sprint goes
 * stale with it**: the board's headers, a PI's `total_available`, the team's own
 * capacity report (which shows the current value beside the proposed one), and
 * every staleness badge. `invalidateAfterPush` is the one place that list lives,
 * because forgetting a member of it leaves a number on screen that the database
 * no longer holds.
 */
function invalidateAfterPush(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['sprints'] })
  qc.invalidateQueries({ queryKey: ['pis'] })
  qc.invalidateQueries({ queryKey: ['teamCapacity'] })
  qc.invalidateQueries({ queryKey: ['teamCapacityStatus'] })
  qc.invalidateQueries({ queryKey: ['teamCapacityPreview'] })
}

/**
 * Staleness for every served project, or for one.
 *
 * Recomputed on the server from live team data on every read, so it is never
 * cached long: a badge that lags is worse than no badge, since the whole claim
 * it makes is about right now.
 */
export const useTeamCapacityStatus = (projectId?: string) =>
  useQuery({
    queryKey: statusKey(projectId),
    queryFn: () => teamPushApi.status(projectId),
    staleTime: 0,
  })

/** The one project's status out of the list, or null when no team serves it. */
export function statusFor(
  statuses: ProjectPushStatus[] | undefined,
  projectId: string,
): ProjectPushStatus | null {
  return statuses?.find((row) => row.project_id === projectId) ?? null
}

/**
 * The review step: what a push into each of these projects would write.
 *
 * One query per project rather than one for the team, because the dialog lets
 * you tick projects individually and a shared response would have to be
 * re-filtered on every toggle. `enabled` keeps them from firing until the dialog
 * is actually open.
 */
export const usePushPreviews = (projectIds: readonly string[], enabled: boolean) =>
  useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: previewKey(projectId),
      queryFn: () => teamPushApi.preview(projectId),
      enabled,
      staleTime: 0,
      retry: false,
    })),
  })

export type PreviewQuery = {
  readonly projectId: string
  readonly data: PushPreview | undefined
  readonly error: unknown
  readonly isLoading: boolean
}

/** Apply one project — the *Retry this one* action on a locked result row. */
export const useApplyPush = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => teamPushApi.apply(projectId),
    onSuccess: () => invalidateAfterPush(qc),
  })
}

/**
 * Apply every project the team serves, in one call.
 *
 * Resolves even when some rows failed: per project and not atomic is the whole
 * design (§6.7), so a locked project is a result to render, never a rejection.
 */
export const usePushTeam = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => teamPushApi.pushTeam(teamId),
    onSuccess: () => invalidateAfterPush(qc),
  })
}
