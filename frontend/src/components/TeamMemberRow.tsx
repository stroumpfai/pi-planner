import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TeamMember } from '@/types'
import { fmtDate } from '@/utils/dates'

interface Props {
  readonly member: TeamMember
  readonly canEdit: boolean
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
  readonly onOpenWorkingDays: () => void
  readonly isFirst: boolean
  readonly isLast: boolean
}

/**
 * One member in the Members view (teams.md §7.2).
 *
 * Hours and focus are shown **read-only, with the date they took effect** — and
 * clicking either goes to Working days rather than editing in place. That is not
 * a missing feature: changing them means dating a new version, and an input here
 * would imply it rewrites the current one, silently restating sprints that are
 * already planned. The chip is a link, and it says what it is looking at.
 */
export function TeamMemberRow({
  member,
  canEdit,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onOpenWorkingDays,
  isFirst,
  isLast,
}: Props) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: member.system_id, disabled: !canEdit })

  const version = member.effective_version
  const since = version ? `since ${fmtDate(version.effective_from)}` : ''

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`px-4 py-3 hover:bg-band/40 ${isDragging ? 'opacity-50 shadow-soft z-10' : ''}`}
    >
      <div className="flex items-center gap-3">
        {canEdit && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${member.name}`}
            title="Drag to reorder"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing"
          >
            ⠿
          </button>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{member.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {[member.role, member.organisation].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>

        <div className="w-40 shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {validity(member)}
        </div>

        {/* Read-only, and legible as such: an inset well rather than a disabled
            input, with the action it does have spelled out in the title. */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenWorkingDays}
            title="Set in Working days"
            className="px-2 py-1 rounded-lg bg-band shadow-soft-inset text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600"
          >
            {version ? `${version.hours_per_day.toFixed(1)} h · ${since}` : 'no pattern'}
          </button>
          <button
            type="button"
            onClick={onOpenWorkingDays}
            title="Set in Working days"
            className="px-2 py-1 rounded-lg bg-band shadow-soft-inset text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600"
          >
            {version ? `focus ${version.focus.toFixed(2)}` : '—'}
          </button>
        </div>

        {canEdit && (
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={onEdit} className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
            {/* The non-drag path to the same result: reordering must not need a
                pointer gesture to be reachable. */}
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label={`Move ${member.name} up`}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              aria-label={`Move ${member.name} down`}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"
            >
              ↓
            </button>
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">Remove</button>
          </div>
        )}
      </div>
    </li>
  )
}

/** When this person is on the team. Blank at either end means open-ended (§3.2). */
function validity(member: TeamMember): string {
  if (member.active_from && member.active_to) {
    return `${fmtDate(member.active_from)} – ${fmtDate(member.active_to)}`
  }
  if (member.active_from) return `from ${fmtDate(member.active_from)}`
  if (member.active_to) return `until ${fmtDate(member.active_to)}`
  return 'always'
}
