import { api } from './api'
import type { TeamAchievement } from '@/types'

/**
 * What a team achieved, per sprint (spec/team-achievement.md §5).
 *
 * Read-only and computed on read: nothing here writes, so a reader sees it too.
 * The window arguments narrow the anchor calendar the same way the capacity
 * report's do.
 */
export const achievementApi = {
  get: (teamId: string, from?: string, to?: string) =>
    api
      .get<TeamAchievement>(`/teams/${teamId}/achievement`, {
        params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      })
      .then((r) => r.data),
}
