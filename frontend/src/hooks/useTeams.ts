import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teamsApi, teamErrorCode } from '@/services/teams'
import type { TeamCreate, TeamUpdate } from '@/types'

const TEAMS_KEY = ['teams'] as const

export const useTeams = () => useQuery({ queryKey: TEAMS_KEY, queryFn: teamsApi.list })

/**
 * Read one team together with the `ETag` a later write has to quote.
 *
 * Deliberately not refreshed in the background. The tag is a *baseline*: it has
 * to be the one belonging to the values the user is looking at, or the write
 * that follows will claim to be based on data it never showed them. When the row
 * really has moved, the server's 412 is what says so.
 */
export const useTeamRead = (teamId: string) =>
  useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

export const useCreateTeam = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TeamCreate) => teamsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAMS_KEY }),
  })
}

/**
 * Refresh the list after a write, and after a 412 as well.
 *
 * A stale write is the one case where failing changes what the user should be
 * looking at: the row they were editing has moved. Refetching here is what lets
 * the caller honestly say "the row has been refreshed" instead of leaving a
 * stale name on screen beside an error about staleness (§4.2).
 */
function refreshOnSettled(qc: ReturnType<typeof useQueryClient>) {
  return {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAMS_KEY })
    },
    onError: (err: unknown) => {
      if (teamErrorCode(err) === 'STALE') {
        qc.invalidateQueries({ queryKey: TEAMS_KEY })
      }
    },
  }
}

/**
 * Update a team against the baseline the caller was shown.
 *
 * The ETag comes from the caller, not from a read taken here. Fetching a fresh
 * tag immediately before the write would make the precondition vacuous: the
 * window it guards would be a millisecond wide, and an edit made while the form
 * sat open would sail through and silently revert whoever else had written in
 * the meantime — the one failure §4.2 exists to prevent. A PATCH carries field
 * values, so it must be based on the values the user actually saw.
 */
export const useUpdateTeam = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ body, etag }: { body: TeamUpdate; etag: string }) =>
      teamsApi.update(teamId, body, etag),
    ...refreshOnSettled(qc),
  })
}

/**
 * Delete a team, reading its tag here rather than taking a caller's baseline.
 *
 * This is the one place the fresh read is the honest choice, and the difference
 * from `useUpdateTeam` is the point: a delete carries no field values, so there
 * is nothing of anyone else's for it to overwrite. The check that actually
 * protects a team — is it still serving projects? — is evaluated server-side at
 * delete time whatever tag arrives (§10).
 */
export const useDeleteTeam = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (teamId: string) => {
      const { etag } = await teamsApi.get(teamId)
      return teamsApi.delete(teamId, etag)
    },
    ...refreshOnSettled(qc),
  })
}
