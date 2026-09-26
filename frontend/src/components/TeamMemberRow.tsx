import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { NOT_COUNTED_RULE, NotCountedChip } from '@/components/NotCountedChip'
import type { TeamMember } from '@/types'
import { fmtDate } from '@/utils/dates'

/**
 * The column template the design fixes for the Members table (design §3).
 *
 * Fixed widths rather than `fr`, because the card is only as wide as its
 * columns: a fraction has nothing to be a fraction *of* until a width is
 * settled, and under intrinsic sizing one long cell would drag every other
 * column out with it. These are the design's proportions, resolved once — and
 * they are what makes `truncate` on the cells mean anything.
 */
export const MEMBER_COLUMNS = 'grid-cols-[22px_13rem_7rem_6rem_9.5rem_10rem_4rem_30px]'
export const MEMBER_COLUMNS_READER = 'grid-cols-[13rem_7rem_6rem_9.5rem_10rem_4rem]'

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
  /** The first member who does not count: the dashed rule goes above this row. */
  readonly startsNotCounted?: boolean
}

/**
 * One member in the Members view (teams.md §7.2; design §3).
 *
 * Hours and focus are shown **read-only, with the date they took effect** — a
 * tinted chip with no input chrome, and clicking either goes to Working days
 * rather than editing in place. That is not a missing feature: changing them
 * means dating a new version, and an input here would imply it rewrites the
 * current one, silently restating sprints that are already planned.
 *
 * The ⋯ menu is the non-drag path to reordering. Order is a preference people
 * set rarely and often from a keyboard, so a pointer-only gesture would leave it
 * unreachable for some of them.
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
  startsNotCounted = false,
}: Props) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: member.system_id, disabled: !canEdit })

  const version = member.effective_version

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid ${canEdit ? MEMBER_COLUMNS : MEMBER_COLUMNS_READER} gap-3 items-center px-4 py-2.5 hover:bg-band/40 ${
        isDragging ? 'opacity-50 shadow-soft z-10' : ''
      } ${startsNotCounted ? NOT_COUNTED_RULE : ''}`}
    >
      {canEdit && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${member.name}`}
          title="Drag to reorder"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing text-sm"
        >
          ⠿
        </button>
      )}

      <div className="flex items-center gap-1.5 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{member.name}</p>
        {/* In the name cell rather than a column of its own: nearly every row
            counts, and a column of "yes" would say nothing (§3.2). */}
        {member.counts_towards_capacity === false && <NotCountedChip />}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.role ?? '—'}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.organisation ?? '—'}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{validity(member)}</p>

      {/* Tinted, no input chrome, no strike-through: effective values with the
          date they took effect, and a click that navigates rather than edits. */}
      <button
        type="button"
        onClick={onOpenWorkingDays}
        title="Set in Working days"
        className="justify-self-start px-2 py-0.5 rounded-lg bg-band shadow-soft-inset text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 truncate max-w-full"
      >
        {version ? `${version.hours_per_day.toFixed(1)} h · since ${fmtDate(version.effective_from)}` : 'no pattern'}
      </button>
      <button
        type="button"
        onClick={onOpenWorkingDays}
        title="Set in Working days"
        className="justify-self-start px-2 py-0.5 rounded-lg bg-band shadow-soft-inset text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600"
      >
        {version ? version.focus.toFixed(2) : '—'}
      </button>

      {canEdit && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-label={`Actions for ${member.name}`}
            className="justify-self-end px-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ⋯
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[10rem] rounded-lg bg-white dark:bg-gray-800 shadow-xl py-1 text-sm"
            >
              <Item onSelect={onEdit}>Edit</Item>
              <Item onSelect={onMoveUp} disabled={isFirst}>Move up</Item>
              <Item onSelect={onMoveDown} disabled={isLast}>Move down</Item>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />
              <Item onSelect={onDelete} destructive>Remove</Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </li>
  )
}

interface ItemProps {
  readonly onSelect: () => void
  readonly disabled?: boolean
  readonly destructive?: boolean
  readonly children: React.ReactNode
}

function Item({ onSelect, disabled = false, destructive = false, children }: ItemProps) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`px-3 py-1.5 outline-none cursor-pointer data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed ${
        destructive
          ? 'text-red-600 dark:text-red-400 data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-900/20'
          : 'text-gray-700 dark:text-gray-200 data-[highlighted]:bg-band'
      }`}
    >
      {children}
    </DropdownMenu.Item>
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
