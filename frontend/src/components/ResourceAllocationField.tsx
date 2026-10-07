import { useState } from 'react'
import { ShareField } from '@/components/ShareField'
import { useTeamMembers } from '@/hooks/useTeamMembers'
import { FULL_SHARE, type Allocation, type RemainingOption, type ShareDraft } from '@/utils/allocation'

interface Props {
  readonly teamId: string
  readonly value: Allocation
  readonly onChange: (next: Allocation) => void
  readonly remaining: RemainingOption
}

/** 2.25 → "2.25", 3 → "3": leftovers fall on quarter days, so two decimals. */
const fmtLeft = (days: number) => String(Math.round(days * 100) / 100)

const radioClass = 'flex items-center gap-2 text-sm'
const firstName = (name: string) => name.split(' ')[0]

/**
 * Whose capacity reaches a project, and how much of each (teams.md §6.3,
 * ADR 0009, ADR 0010, ADR 0012).
 *
 * Three modes, each with exactly one place to type a share:
 *
 * - **Whole team** at one share, with an optional exception per member.
 * - **Specific members**, each with a share of their own, starting at 100%.
 * - **Remaining capacity**: whatever the team's other projects leave of each
 *   member. Always listed; disabled with the reason when it makes no sense.
 *
 * Members tracked for their absences only are listed but cannot be ticked or
 * given a share: their capacity reaches no project (§3.2).
 */
export function ResourceAllocationField({ teamId, value, onChange, remaining }: Props) {
  const { data: members } = useTeamMembers(teamId)
  const [showOverrides, setShowOverrides] = useState(Object.keys(value.overrides).length > 0)
  const order = (members ?? []).map((m) => m.system_id)

  const setMode = (mode: Allocation['mode']) => onChange({ ...value, mode })

  const setOverride = (memberId: string, draft: ShareDraft) =>
    onChange({ ...value, overrides: { ...value.overrides, [memberId]: draft } })

  const setShare = (memberId: string, draft: ShareDraft) =>
    onChange({ ...value, shares: { ...value.shares, [memberId]: draft } })

  const toggle = (memberId: string) => {
    const ticked = value.memberIds.includes(memberId)
    const next = new Set(value.memberIds)
    if (ticked) next.delete(memberId)
    else next.add(memberId)
    onChange({
      ...value,
      // Kept in the team's display order rather than click order.
      memberIds: order.filter((id) => next.has(id)),
      shares: ticked ? value.shares : { ...value.shares, [memberId]: value.shares[memberId] ?? FULL_SHARE },
    })
  }

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Resource allocation</legend>

      <label className={`mt-2 ${radioClass} text-gray-700 dark:text-gray-300`}>
        <input
          type="radio"
          name="allocation"
          value="team"
          checked={value.mode === 'team'}
          onChange={() => setMode('team')}
        />
        Whole team
      </label>
      {value.mode === 'team' && (
        <div className="mt-2 ml-6 space-y-2">
          <ShareField
            id="allocation-team-share"
            label="Share of the team"
            compact
            unit={value.team.unit}
            value={value.team.value}
            onChange={(unit, v) => onChange({ ...value, team: { unit, value: v } })}
          />
          {!showOverrides ? (
            <button
              type="button"
              onClick={() => setShowOverrides(true)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Give some members a different share
            </button>
          ) : (
            <div className="space-y-1">
              {(members ?? [])
                .filter((m) => m.counts_towards_capacity)
                .map((member) => {
                  const draft = value.overrides[member.system_id] ?? { unit: 'pct', value: '' }
                  return (
                    <div key={member.system_id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{member.name}</span>
                      <ShareField
                        compact
                        id={`member-share-${member.system_id}`}
                        label={`${member.name}'s share`}
                        unit={draft.unit}
                        value={draft.value}
                        placeholder="same"
                        onChange={(unit, v) => setOverride(member.system_id, { unit, value: v })}
                      />
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      <label className={`mt-2 ${radioClass} text-gray-700 dark:text-gray-300`}>
        <input
          type="radio"
          name="allocation"
          value="some"
          checked={value.mode === 'some'}
          onChange={() => setMode('some')}
        />
        Specific members
      </label>
      {value.mode === 'some' && (
        <div className="mt-2 ml-6 space-y-1">
          {(members ?? []).map((member) => {
            const counts = member.counts_towards_capacity
            const ticked = value.memberIds.includes(member.system_id)
            const draft = value.shares[member.system_id] ?? FULL_SHARE
            return (
              <div key={member.system_id} className="flex items-center justify-between gap-3">
                <label
                  className={`flex items-center gap-2 text-sm ${
                    counts ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={!counts && !ticked}
                    onChange={() => toggle(member.system_id)}
                  />
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
                    onChange={(unit, v) => setShare(member.system_id, { unit, value: v })}
                  />
                )}
              </div>
            )
          })}
          {value.memberIds.length === 0 && (
            <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
              Nobody is ticked, so this project gets no capacity at all.
            </p>
          )}
        </div>
      )}

      <label
        className={`mt-2 ${radioClass} ${
          remaining.enabled ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'
        }`}
      >
        <input
          type="radio"
          name="allocation"
          value="remaining"
          checked={value.mode === 'remaining'}
          disabled={!remaining.enabled}
          onChange={() => setMode('remaining')}
        />
        Remaining capacity
      </label>
      {!remaining.enabled && (
        <p className="mt-1 ml-6 text-xs text-gray-400 dark:text-gray-500">{remaining.hint}</p>
      )}
      {remaining.enabled && value.mode === 'remaining' && <Leftovers option={remaining} />}
    </fieldset>
  )
}

interface LeftoversProps {
  readonly option: Extract<RemainingOption, { enabled: true }>
}

/** What the remaining project would take today, member by member. */
function Leftovers({ option }: LeftoversProps) {
  const free = option.leftovers.filter((l) => l.days > 0)
  const full = option.leftovers.filter((l) => l.days === 0)
  const total = free.reduce((sum, l) => sum + l.days, 0)
  return (
    <div role="status" className="mt-2 ml-6 space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
      <p>
        {option.hint ?? (
          <>
            What the other projects leave, member by member. Today ≈{' '}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{fmtLeft(total)} d/wk</span>:
          </>
        )}
      </p>
      {option.hint === null && (
        <ul className="flex flex-wrap gap-1.5">
          {free.map((l) => (
            <li
              key={l.memberId}
              className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 tabular-nums"
            >
              {firstName(l.name)} {fmtLeft(l.days)} of {fmtLeft(l.contractedDays)}
            </li>
          ))}
        </ul>
      )}
      {option.hint === null && full.length > 0 && (
        <p>
          {full.map((l) => firstName(l.name)).join(', ')} {full.length === 1 ? 'is' : 'are'} fully
          booked and {full.length === 1 ? 'gives' : 'give'} nothing.
        </p>
      )}
    </div>
  )
}
