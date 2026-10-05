import { useTeamMembers } from '@/hooks/useTeamMembers'

interface Props {
  readonly teamId: string
  readonly allMembers: boolean
  readonly memberIds: readonly string[]
  readonly onChange: (allMembers: boolean, memberIds: string[]) => void
}

/**
 * Whose capacity reaches a project: the whole team, or only some members
 * (teams.md §6.3, ADR 0009).
 *
 * This is how one team holds a few people who work on one project exclusively:
 * that project counts only them, and the others count everyone else. The share
 * then applies to the members ticked here, not to the whole team.
 *
 * Members tracked for their absences only are listed but cannot be ticked:
 * their capacity reaches no project, scoped or not (§3.2).
 */
export function MemberScopeField({ teamId, allMembers, memberIds, onChange }: Props) {
  const { data: members } = useTeamMembers(teamId)
  const selected = new Set(memberIds)

  const toggle = (memberId: string) => {
    const next = new Set(selected)
    if (next.has(memberId)) next.delete(memberId)
    else next.add(memberId)
    // Kept in the team's display order rather than click order.
    onChange(false, (members ?? []).map((m) => m.system_id).filter((id) => next.has(id)))
  }

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
          onChange={() => onChange(false, [...memberIds])}
        />
        Only these members
      </label>

      {!allMembers && (
        <div className="mt-2 ml-6 space-y-1">
          {(members ?? []).map((member) => (
            <label
              key={member.system_id}
              className={`flex items-center gap-2 text-sm ${
                member.counts_towards_capacity
                  ? 'text-gray-700 dark:text-gray-300'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(member.system_id)}
                disabled={!member.counts_towards_capacity && !selected.has(member.system_id)}
                onChange={() => toggle(member.system_id)}
              />
              {member.name}
              {!member.counts_towards_capacity && (
                <span className="text-xs">(absences only)</span>
              )}
            </label>
          ))}
          {memberIds.length === 0 && (
            <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
              Nobody is ticked, so this project gets no capacity at all.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
