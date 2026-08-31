import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignmentErrorCode, teamProjectsApi } from '@/services/teamProjects'
import type { TeamAssignmentCreate, TeamAssignmentUpdate } from '@/types'

const assignmentsKey = (teamId: string) => ['teamProjects', teamId] as const
const capacityKey = (teamId: string, from?: string, to?: string) =>
  ['teamCapacity', teamId, from ?? 'all', to ?? 'all'] as const

/**
 * Anything that changes an assignment changes the capacity report as well.
 *
 * The share and the factor are inputs to the numbers the Capacity view shows, so
 * the two caches move together — and the home page's team row counts projects,
 * which is why the team list joins them.
 */
function invalidate(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  qc.invalidateQueries({ queryKey: assignmentsKey(teamId) })
  qc.invalidateQueries({ queryKey: ['teamCapacity', teamId] })
  qc.invalidateQueries({ queryKey: ['teams'] })
}

function refreshOnSettled(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  return {
    onSuccess: () => invalidate(qc, teamId),
    onError: (err: unknown) => {
      if (assignmentErrorCode(err) === 'STALE') invalidate(qc, teamId)
    },
  }
}

export const useTeamProjects = (teamId: string) =>
  useQuery({
    queryKey: assignmentsKey(teamId),
    queryFn: () => teamProjectsApi.list(teamId),
    enabled: teamId !== '',
  })

/**
 * The capacity report.
 *
 * Computed on read, from members, patterns and the anchor project's sprints —
 * nothing is stored, and nothing here writes a sprint. A push is the only thing
 * that does (§6.7).
 */
export const useTeamCapacity = (teamId: string, from?: string, to?: string) =>
  useQuery({
    queryKey: capacityKey(teamId, from, to),
    queryFn: () => teamProjectsApi.capacity(teamId, from, to),
    enabled: teamId !== '',
  })

export const useAssignProject = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TeamAssignmentCreate) => teamProjectsApi.assign(teamId, body),
    onSuccess: () => invalidate(qc, teamId),
  })
}

export const useUpdateAssignment = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      body,
      etag,
    }: {
      projectId: string
      body: TeamAssignmentUpdate
      etag: string
    }) => teamProjectsApi.update(teamId, projectId, body, etag),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useUnassignProject = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, etag }: { projectId: string; etag: string }) =>
      teamProjectsApi.unassign(teamId, projectId, etag),
    ...refreshOnSettled(qc, teamId),
  })
}
