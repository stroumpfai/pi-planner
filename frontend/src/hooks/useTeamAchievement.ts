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
