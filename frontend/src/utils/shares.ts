import type { MemberLoad, MemberShare } from '@/types'

/**
 * Shares as people say them: a percentage, or days a week (teams.md §6.3.2,
 * ADR 0010). A days share is a fraction of each member's own contract, so the
 * app shows it as entered and never converts it for display.
 */
export type ShareUnit = 'pct' | 'days'

/** 2 → "2", 2.5 → "2.5", 4.333 → "4.3". */
export const fmtDays = (days: number): string =>
  Number.isInteger(days) ? String(days) : String(Math.round(days * 10) / 10)

/** "70%" or "2 d/wk", whichever the share was entered as. */
export function formatShare(pct: number | null | undefined, days: number | null | undefined): string {
  if (days != null) return `${fmtDays(days)} d/wk`
  return `${pct ?? 100}%`
}

/** "120% · 6 of 5 d/wk" — the load as a percentage and in days. */
export const formatLoad = (load: MemberLoad): string =>
  `${Math.round(load.share_pct)}% · ${fmtDays(load.days_per_week)} of ${fmtDays(load.contracted_days)} d/wk`

/** The request fields for a share typed as *value* in *unit*. */
export function shareFields(unit: ShareUnit, value: string): { share_pct?: number; share_days?: number } {
  return unit === 'days' ? { share_days: Number(value) } : { share_pct: Number(value) }
}

/** A member's own share, as text for an input, and its unit. */
export function memberShareText(share: MemberShare): { unit: ShareUnit; value: string } {
  return share.share_days != null
    ? { unit: 'days', value: String(share.share_days) }
    : { unit: 'pct', value: String(share.share_pct ?? '') }
}

/**
 * Who a project counts, with each member's own share where they have one:
 * "whole team · Anna 2 d/wk", or "Anna 2 d/wk, Bruno" for a scoped project.
 * Null for the plain case, a whole team at the assignment's share.
 */
export function describeCounted(
  allMembers: boolean,
  memberIds: readonly string[],
  shares: readonly MemberShare[],
  nameOf: (memberId: string) => string,
): string | null {
  const own = new Map(shares.map((s) => [s.member_id, formatShare(s.share_pct, s.share_days)]))
  const named = (id: string) => (own.has(id) ? `${nameOf(id)} ${own.get(id)}` : nameOf(id))
  if (allMembers) {
    if (shares.length === 0) return null
    return `whole team · ${shares.map((s) => named(s.member_id)).join(', ')}`
  }
  return memberIds.length > 0 ? memberIds.map(named).join(', ') : 'nobody — no capacity'
}
