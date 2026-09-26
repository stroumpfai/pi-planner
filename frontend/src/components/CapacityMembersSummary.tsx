import { splitByCapacity } from '@/utils/capacityMembers'

interface SummaryMember {
  readonly name: string
  readonly role?: string | null
  readonly counts_towards_capacity?: boolean
}

interface Props {
  /** The rows the view itself shows, so the line can never disagree with them. */
  readonly members: readonly SummaryMember[]
}

/**
 * Who the team's capacity is made of, in one line (teams.md §3.2).
 *
 * The same line heads every team view that lists people. The Capacity view has
 * the split built into its table, but the others list everyone alike, and "does
 * Anna count?" should not need a trip to the edit dialog to answer. The people
 * who do not count are named, because there are rarely more than two or three
 * of them and a bare number would send the reader looking for them anyway.
 */
export function CapacityMembersSummary({ members }: Props) {
  if (members.length === 0) return null
  const { counted, notCounted } = splitByCapacity(members)
  const total = members.length === 1 ? '1 member' : `${members.length} members`

  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {total}
      {' · '}
      {notCounted.length === 0 ? (
        'all count towards capacity'
      ) : (
        <>
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {counted.length} {counted.length === 1 ? 'counts' : 'count'} towards capacity
          </span>
          {' · '}
          {notCounted.length} tracked for absences only:{' '}
          {notCounted.map((m) => (m.role ? `${m.name} (${m.role})` : m.name)).join(', ')}
        </>
      )}
    </p>
  )
}
