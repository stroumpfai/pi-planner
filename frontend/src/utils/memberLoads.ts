import type { MemberLoad } from '@/types'

/** One share level and the members on it, e.g. 100% — Anna, Bruno. */
export interface LoadGroup {
  readonly sharePct: number
  readonly names: readonly string[]
}

/**
 * Members grouped by load, heaviest first (teams.md §6.3, ADR 0009).
 *
 * A member's load is the sum of the shares of every project that counts them.
 * With every assignment counting the whole team, that is one group: the old
 * team-wide total. Once some projects count only some people, the groups say
 * who is carrying what.
 */
export function groupLoads(loads: readonly MemberLoad[]): LoadGroup[] {
  const byShare = new Map<number, string[]>()
  for (const load of loads) {
    // Whole percent: a load in days on a 4.5-day contract is 44.4…%, and two
    // members that close belong in one group.
    const pct = Math.round(load.share_pct)
    const names = byShare.get(pct) ?? []
    names.push(load.name)
    byShare.set(pct, names)
  }
  return [...byShare.entries()]
    .sort(([a], [b]) => b - a)
    .map(([sharePct, names]) => ({ sharePct, names }))
}

/** The members over 100%: warned about, never blocked. */
export const overAllocated = (loads: readonly MemberLoad[]): MemberLoad[] =>
  loads.filter((load) => load.share_pct > 100)
