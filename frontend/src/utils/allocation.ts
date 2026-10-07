import type { MemberLoad, MemberShare, TeamAssignment } from '@/types'
import { memberShareText, shareFields, type ShareUnit } from '@/utils/shares'

/**
 * How a project's capacity is drawn from the team: the dialog's "Resource
 * allocation" (teams.md §6.3, ADR 0009, ADR 0010, ADR 0012).
 *
 * - **team**: the whole team at one share, with optional per-member exceptions.
 * - **some**: only the ticked members, each with a share of their own.
 * - **remaining**: from every member, whatever the team's other projects leave.
 *
 * Shares are kept as typed text: a share passes through values the API would
 * refuse ("0" on the way to "0.5"), and rebuilding the input from parsed numbers
 * would erase them mid-keystroke.
 */
export type AllocationMode = 'team' | 'some' | 'remaining'

export interface ShareDraft {
  readonly unit: ShareUnit
  readonly value: string
}

export interface Allocation {
  readonly mode: AllocationMode
  /** The whole team's share, in mode `team`. */
  readonly team: ShareDraft
  /** The ticked members, in the team's display order, in mode `some`. */
  readonly memberIds: readonly string[]
  /** Members whose share differs from the team's, in mode `team`; empty means "the team's". */
  readonly overrides: Readonly<Record<string, ShareDraft>>
  /**
   * Each member's share in mode `some`. Kept apart from the overrides, so that
   * switching modes back and forth loses neither.
   */
  readonly shares: Readonly<Record<string, ShareDraft>>
}

/** What a newly ticked member starts with: all of them. */
export const FULL_SHARE: ShareDraft = { unit: 'pct', value: '100' }

export const NEW_ALLOCATION: Allocation = {
  mode: 'team',
  team: FULL_SHARE,
  memberIds: [],
  overrides: {},
  shares: {},
}

const assignmentShare = (a: TeamAssignment): ShareDraft =>
  a.share_days != null
    ? { unit: 'days', value: String(a.share_days) }
    : { unit: 'pct', value: String(a.share_pct) }

/**
 * The dialog's state for an existing assignment.
 *
 * A scoped one shows each member's effective share in their own field: their
 * override, else the assignment's. Saving it unchanged gives back the same
 * shares (see {@link allocationFields}).
 */
export function allocationOf(a: TeamAssignment): Allocation {
  const team = assignmentShare(a)
  const own: Record<string, ShareDraft> = Object.fromEntries(
    (a.member_shares ?? []).map((s) => [s.member_id, memberShareText(s)]),
  )
  if (a.remaining) return { ...NEW_ALLOCATION, mode: 'remaining' }
  if (a.all_members ?? true) return { ...NEW_ALLOCATION, team, overrides: own }
  const memberIds = a.member_ids ?? []
  return {
    ...NEW_ALLOCATION,
    mode: 'some',
    memberIds,
    shares: Object.fromEntries(memberIds.map((id) => [id, own[id] ?? team])),
  }
}

/** The request fields an allocation sends, the same for assigning and editing. */
export interface AllocationFields {
  readonly share_pct?: number
  readonly share_days?: number
  readonly all_members?: boolean
  readonly member_ids?: string[]
  readonly member_shares?: MemberShare[]
  readonly remaining?: boolean
}

export type AllocationResult =
  | { readonly ok: true; readonly fields: AllocationFields }
  | { readonly ok: false; readonly error: string }

const filled = (d: ShareDraft | undefined): d is ShareDraft =>
  d !== undefined && d.value.trim() !== '' && Number(d.value) > 0

const memberShare = (memberId: string, d: ShareDraft): MemberShare => ({
  member_id: memberId,
  ...shareFields(d.unit, d.value),
})

/**
 * What to send for *a*, or why it cannot be sent.
 *
 * In mode `some` the shares are **normalised**: when every ticked member has
 * the same share it goes on the assignment with no overrides, exactly how such
 * an assignment has always been stored, so its figures keep the arithmetic they
 * had (ADR 0010). Otherwise the assignment is 100% and each member who differs
 * carries their own.
 *
 * *order* is the team's display order, so the overrides come out stable.
 */
export function allocationFields(
  a: Allocation,
  order: readonly string[],
  nameOf: (memberId: string) => string,
): AllocationResult {
  if (a.mode === 'remaining') return { ok: true, fields: { remaining: true } }

  if (a.mode === 'team') {
    if (!filled(a.team)) return { ok: false, error: 'Give the team a share.' }
    return {
      ok: true,
      fields: {
        ...shareFields(a.team.unit, a.team.value),
        all_members: true,
        member_ids: [],
        member_shares: order
          .filter((id) => filled(a.overrides[id]))
          .map((id) => memberShare(id, a.overrides[id])),
      },
    }
  }

  const ticked = order.filter((id) => a.memberIds.includes(id))
  const missing = ticked.find((id) => !filled(a.shares[id]))
  if (missing !== undefined) {
    return { ok: false, error: `Give ${nameOf(missing)} a share, or untick them.` }
  }
  const key = (d: ShareDraft) => `${d.unit}:${Number(d.value)}`
  const shares = ticked.map((id) => a.shares[id])
  const uniform = shares.length > 0 && shares.every((d) => key(d) === key(shares[0]))
  return {
    ok: true,
    fields: {
      ...(uniform ? shareFields(shares[0].unit, shares[0].value) : { share_pct: 100 }),
      all_members: false,
      member_ids: ticked,
      member_shares: uniform
        ? []
        : ticked
            .filter((id) => key(a.shares[id]) !== key(FULL_SHARE))
            .map((id) => memberShare(id, a.shares[id])),
    },
  }
}

/** One member's leftover: what the other projects leave of their week. */
export interface Leftover {
  readonly memberId: string
  readonly name: string
  readonly days: number
  readonly contractedDays: number
}

export type RemainingOption =
  | { readonly enabled: true; readonly hint: string | null; readonly leftovers: readonly Leftover[] }
  | { readonly enabled: false; readonly hint: string }

/** A member's share of *a* in days a week, or 0 when it does not count them. */
function bookedDays(a: TeamAssignment, load: MemberLoad): number {
  if (a.remaining) return 0
  const counted = (a.all_members ?? true) || (a.member_ids ?? []).includes(load.member_id)
  if (!counted) return 0
  const own = (a.member_shares ?? []).find((s) => s.member_id === load.member_id)
  const days = own ? own.share_days : a.share_days
  const pct = own ? own.share_pct : a.share_pct
  return days != null ? days : (load.contracted_days * (pct ?? 100)) / 100
}

/**
 * Whether the dialog can offer "Remaining capacity", and what it would take
 * (§6.3.4, ADR 0012).
 *
 * It is always listed, and disabled with the reason when it makes no sense: a
 * team has one remaining project, and a remainder of nothing is no allocation.
 * *editing* is the project the dialog is open on: its own share does not count
 * against what is left, since taking the remainder replaces it.
 */
export function remainingOption(
  assignments: readonly TeamAssignment[],
  loads: readonly MemberLoad[],
  editing?: string,
): RemainingOption {
  const holder = assignments.find((a) => a.remaining && a.project_id !== editing)
  if (holder) {
    return {
      enabled: false,
      hint: `${holder.project_name} already takes the remaining capacity. Only one project can.`,
    }
  }
  if (loads.length === 0) return { enabled: false, hint: 'No member counts towards capacity.' }

  const others = assignments.filter((a) => a.project_id !== editing && !a.remaining)
  const leftovers = loads.map((load) => ({
    memberId: load.member_id,
    name: load.name,
    contractedDays: load.contracted_days,
    days: Math.max(
      0,
      load.contracted_days - others.reduce((sum, a) => sum + bookedDays(a, load), 0),
    ),
  }))
  if (leftovers.every((l) => l.days === 0)) {
    return {
      enabled: false,
      hint: 'Nobody has capacity left: the other projects book every member fully.',
    }
  }
  return {
    enabled: true,
    hint:
      others.length === 0
        ? 'Today this is the whole team. It shrinks as other projects take partial shares.'
        : null,
    leftovers,
  }
}
