import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memberErrorCode, teamMembersApi } from '@/services/teamMembers'
import type {
  PatternVersionCreate,
  PatternVersionUpdate,
  TeamMemberCreate,
  TeamMemberUpdate,
} from '@/types'

/**
 * Members are keyed by team **and by as-of date**.
 *
 * The date is part of the answer, not a filter applied to it: the same member
 * reads differently before and after a contract change, and two views are on
 * screen wanting different dates. Sharing one cache entry between them would make
 * the Working days grid flick to today's pattern whenever the Members tab
 * refetched (§7.3).
 */
const membersKey = (teamId: string, asOf?: string) => ['teamMembers', teamId, asOf ?? 'today'] as const
const versionsKey = (teamId: string, memberId: string) =>
  ['patternVersions', teamId, memberId] as const

function invalidateTeam(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  qc.invalidateQueries({ queryKey: ['teamMembers', teamId] })
  qc.invalidateQueries({ queryKey: ['patternVersions', teamId] })
  // The home page's member count comes off the team row.
  qc.invalidateQueries({ queryKey: ['teams'] })
}

/**
 * Refresh after a write, and after a 412 as well.
 *
 * A stale write is the one failure that changes what the user should be looking
 * at — the row they were editing has moved — so refetching here is what lets the
 * caller honestly say the list has been refreshed (§4.2).
 */
function refreshOnSettled(qc: ReturnType<typeof useQueryClient>, teamId: string) {
  return {
    onSuccess: () => invalidateTeam(qc, teamId),
    onError: (err: unknown) => {
      if (memberErrorCode(err) === 'STALE') invalidateTeam(qc, teamId)
    },
  }
}

export const useTeamMembers = (teamId: string, asOf?: string) =>
  useQuery({
    queryKey: membersKey(teamId, asOf),
    queryFn: () => teamMembersApi.list(teamId, asOf),
    enabled: teamId !== '',
  })

/** Every version a member owns — the Working days row's timeline reads this. */
export const useMemberVersions = (teamId: string, memberId: string | null) =>
  useQuery({
    queryKey: versionsKey(teamId, memberId ?? ''),
    queryFn: () => teamMembersApi.versions(teamId, memberId as string),
    enabled: teamId !== '' && memberId !== null,
  })

export const useCreateMember = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TeamMemberCreate) => teamMembersApi.create(teamId, body),
    onSuccess: () => invalidateTeam(qc, teamId),
  })
}

/**
 * Update a member against the baseline the caller was shown.
 *
 * The ETag comes from the row the user is looking at, never from a read taken
 * here: fetching a fresh tag immediately before the write would make the
 * precondition vacuous, and an edit made while the form sat open would sail
 * through and silently revert whoever wrote in the meantime (§4.2).
 */
export const useUpdateMember = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      memberId,
      body,
      etag,
    }: {
      memberId: string
      body: TeamMemberUpdate
      etag: string
    }) => teamMembersApi.update(teamId, memberId, body, etag),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useDeleteMember = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, etag }: { memberId: string; etag: string }) =>
      teamMembersApi.delete(teamId, memberId, etag),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useReorderMembers = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: string[]) => teamMembersApi.reorder(teamId, order),
    onSuccess: () => invalidateTeam(qc, teamId),
  })
}

/**
 * Date a contract change. Posting onto an existing date edits that version (§3.3).
 *
 * `etag` is that version's, and is required whenever the date is already taken:
 * replacing a row someone else may have moved is a write like any other (§4.2).
 */
export const useAddPatternVersion = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      memberId,
      body,
      etag,
    }: {
      memberId: string
      body: PatternVersionCreate
      etag?: string
    }) => teamMembersApi.addVersion(teamId, memberId, body, etag),
    onSuccess: () => invalidateTeam(qc, teamId),
  })
}

export const useUpdatePatternVersion = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      memberId,
      versionId,
      body,
      etag,
    }: {
      memberId: string
      versionId: string
      body: PatternVersionUpdate
      etag: string
    }) => teamMembersApi.updateVersion(teamId, memberId, versionId, body, etag),
    ...refreshOnSettled(qc, teamId),
  })
}

export const useDeletePatternVersion = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      memberId,
      versionId,
      etag,
    }: {
      memberId: string
      versionId: string
      etag: string
    }) => teamMembersApi.deleteVersion(teamId, memberId, versionId, etag),
    ...refreshOnSettled(qc, teamId),
  })
}
