import { useState } from 'react'
import { ShareField } from '@/components/ShareField'
import { useTeamMembers } from '@/hooks/useTeamMembers'
import type { MemberShare } from '@/types'
import { memberShareText, type ShareUnit } from '@/utils/shares'

interface Props {
  readonly teamId: string
  readonly allMembers: boolean
  readonly memberIds: readonly string[]
  readonly onChange: (allMembers: boolean, memberIds: string[]) => void
  readonly memberShares: readonly MemberShare[]
  readonly onSharesChange: (shares: MemberShare[]) => void
}

interface Draft {
  readonly unit: ShareUnit
  readonly value: string
}

/**
 * Whose capacity reaches a project, and how much of each (teams.md §6.3,
 * ADR 0009, ADR 0010).
 *
 * The whole team, or only the members ticked — for a few people who work on one
 * project exclusively. Any member can also be given a share of their own, as a
 * percentage or days a week: "Anna, 2 days a week". Left empty, a member takes
 * the assignment's share.
 *
 * Members tracked for their absences only are listed but cannot be ticked or
 * given a share: their capacity reaches no project (§3.2).
 *
 * The typed text is kept here, not in the parent: a share passes through values
 * the API would refuse ("0" on the way to "0.5"), and rebuilding the input from
 * parsed numbers would erase them mid-keystroke.
 */
export function MemberScopeField({
  teamId,
  allMembers,
  memberIds,
  onChange,
  memberShares,
  onSharesChange,
}: Props) {
  const { data: members } = useTeamMembers(teamId)
  const selected = new Set(memberIds)
  const order = (members ?? []).map((m) => m.system_id)

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(memberShares.map((s) => [s.member_id, memberShareText(s)])),
  )
  const [showShares, setShowShares] = useState(memberShares.length > 0)

  const emitShares = (next: Record<string, Draft>, counted: (id: string) => boolean) => {
    setDrafts(next)
    onSharesChange(
      order
        .filter((id) => counted(id) && next[id] && Number(next[id].value) > 0)
        .map((id) => ({
          member_id: id,
          ...(next[id].unit === 'days'
            ? { share_days: Number(next[id].value) }
            : { share_pct: Number(next[id].value) }),
        })),
    )
  }

  const setDraft = (memberId: string, unit: ShareUnit, value: string) =>
    emitShares({ ...drafts, [memberId]: { unit, value } }, (id) => allMembers || selected.has(id))

  const toggle = (memberId: string) => {
    const next = new Set(selected)
    if (next.has(memberId)) next.delete(memberId)
    else next.add(memberId)
    // Kept in the team's display order rather than click order.
    onChange(false, order.filter((id) => next.has(id)))
    // A member unticked keeps no share of a project that no longer counts them.
    emitShares(drafts, (id) => next.has(id))
  }

  const listed = !allMembers || showShares

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Counted members</legend>
      <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="radio"
          name="member_scope"
          value="all"
          checked={allMembers}
          onChange={() => onChange(true, [])}
        />
        Whole team
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="radio"
          name="member_scope"
          value="some"
          checked={!allMembers}
          onChange={() => {
            onChange(false, [...memberIds])
            // The server counts anyone with a share; keep only those ticked here.
            emitShares(drafts, (id) => selected.has(id))
          }}
        />
        Only these members
      </label>

      {allMembers && !showShares && (
        <button
          type="button"
          onClick={() => setShowShares(true)}
          className="mt-2 ml-6 text-xs text-blue-600 hover:text-blue-800"
        >
          Give some members a different share
        </button>
      )}

      {listed && (
        <div className="mt-2 ml-6 space-y-1">
          {(members ?? []).map((member) => {
            const counts = member.counts_towards_capacity
            const ticked = allMembers || selected.has(member.system_id)
            const draft = drafts[member.system_id] ?? { unit: 'pct', value: '' }
            return (
              <div key={member.system_id} className="flex items-center justify-between gap-3">
                <label
                  className={`flex items-center gap-2 text-sm ${
                    counts ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {!allMembers && (
                    <input
                      type="checkbox"
                      checked={selected.has(member.system_id)}
                      disabled={!counts && !selected.has(member.system_id)}
                      onChange={() => toggle(member.system_id)}
                    />
                  )}
                  {member.name}
                  {!counts && <span className="text-xs">(absences only)</span>}
                </label>
                {counts && ticked && (
                  <ShareField
                    compact
                    id={`member-share-${member.system_id}`}
                    label={`${member.name}'s share`}
                    unit={draft.unit}
                    value={draft.value}
                    placeholder="same"
                    onChange={(unit, value) => setDraft(member.system_id, unit, value)}
                  />
                )}
              </div>
            )
          })}
          {!allMembers && memberIds.length === 0 && memberShares.length === 0 && (
            <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
              Nobody is ticked, so this project gets no capacity at all.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
