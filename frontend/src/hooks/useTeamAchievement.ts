import { useQuery } from '@tanstack/react-query'
import { achievementApi } from '@/services/achievement'

/**
 * The first two parts of the key are the contract with the SSE subscription:
 * `team:achievement:changed` invalidates `['team-achievement', teamId]`, which
 * covers every window of that team at once.
 */
export const teamAchievementKey = (teamId: string, from?: string, to?: string) =>
  ['team-achievement', teamId, from ?? 'all', to ?? 'all'] as const

/**
 * The achievement report (spec/team-achievement.md §5).
 *
 * The counterpart of `useTeamCapacity`: the same team, the same sprint columns,
 * derived per request from completion dates — nothing is stored or frozen (§5.6).
 */
export const useTeamAchievement = (teamId: string, from?: string, to?: string) =>
  useQuery({
    queryKey: teamAchievementKey(teamId, from, to),
    queryFn: () => achievementApi.get(teamId, from, to),
    enabled: teamId !== '',
  })

/**
 * Under the same `['team-achievement', teamId]` prefix, so the SSE invalidation
 * that refreshes the report refreshes the suggestion too.
 */
export const projectVelocityKey = (teamId: string, projectId: string, sprints: number) =>
  ['team-achievement', teamId, 'velocity', projectId, sprints] as const

/**
 * The measured pts/PD the assignment editor offers beside the typed factor
 * (spec/team-achievement.md §6.3). `enabled` lets the editor fetch only while it
 * is open; the previous window's answer stays on screen while a new one loads, so the
 * block does not blink when the sprint count changes.
 */
export const useProjectVelocity = (
  teamId: string,
  projectId: string,
  sprints: number,
  enabled = true,
) =>
  useQuery({
    queryKey: projectVelocityKey(teamId, projectId, sprints),
    queryFn: () => achievementApi.velocity(teamId, projectId, sprints),
    enabled: enabled && teamId !== '' && projectId !== '',
    // Only a previous window of the *same* project may stand in for this one.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[3] === projectId ? previous : undefined,
  })
