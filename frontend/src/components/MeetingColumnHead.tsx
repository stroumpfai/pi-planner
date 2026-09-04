import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDuration } from '@/components/MeetingDialog'
import { KIND_LABELS } from '@/components/scheduleForm'
import type { Meeting, ScheduleKind } from '@/types'

interface Props {
  readonly meeting: Meeting
  readonly canEdit: boolean
  /** Every member attends — the head checkbox is then ticked rather than mixed. */
  readonly allAttending: boolean
  readonly someAttending: boolean
  readonly onToggleColumn: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onMoveLeft: () => void
  readonly onMoveRight: () => void
  readonly isFirst: boolean
  readonly isLast: boolean
}

/**
 * One meeting, as a column head in the attendance matrix (teams.md §7.5).
 *
 * The head carries the meeting's whole identity — title, duration, and the
 * schedule **in words** — because the grid has no time axis to read it off. That
 * is the trade the matrix makes: a 15-minute stand-up and an 8-hour workshop are
 * two columns rather than two bars in wildly wrong proportion, and the schedule
 * moves into the header where it is stated once instead of drawn badly.
 *
 * The checkbox here selects the **whole column**: "everyone attends the stand-up"
 * is one click, which is the common case and would otherwise be six.
 *
 * Order is the team's, not chronological, so the head is draggable — with Move
 * left / Move right in the ⋯ menu as the non-drag path, since column order is a
 * preference people set rarely and often from a keyboard.
 */
export function MeetingColumnHead({
  meeting,
  canEdit,
  allAttending,
  someAttending,
  onToggleColumn,
  onEdit,
  onDelete,
  onMoveLeft,
  onMoveRight,
  isFirst,
  isLast,
}: Props) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: meeting.system_id, disabled: !canEdit })

  return (
    <th
      ref={setNodeRef}
      scope="col"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`align-top px-3 py-3 text-left w-[9.5rem] min-w-[9.5rem] border-l border-white/60 dark:border-white/10 ${
        isDragging ? 'opacity-50 z-10' : ''
      }`}
    >
      <div className="flex items-start gap-1">
        {canEdit && (
          <input
            type="checkbox"
            checked={allAttending}
            ref={(node) => {
              // "Some, not all" is a third state, and it is the one that says a
              // click will add the rest rather than clear everybody.
              if (node) node.indeterminate = !allAttending && someAttending
            }}
            onChange={onToggleColumn}
            aria-label={`Everyone attends ${meeting.title}`}
            title="Everyone attends"
            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        )}
        <span className="flex-1 min-w-0 text-xs font-semibold text-gray-800 dark:text-gray-100 break-words">
          {meeting.title}
        </span>
        {canEdit && (
          <>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Drag to reorder ${meeting.title}`}
              title="Drag to reorder"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing text-xs"
            >
              ⠿
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                aria-label={`Actions for ${meeting.title}`}
                className="px-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs"
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
                  <Item onSelect={onMoveLeft} disabled={isFirst}>Move left</Item>
                  <Item onSelect={onMoveRight} disabled={isLast}>Move right</Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />
                  <Item onSelect={onDelete} destructive>Delete</Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        )}
      </div>

      <span className="mt-1 block text-[11px] font-normal text-gray-600 dark:text-gray-300">
        {formatDuration(meeting.duration_minutes)}
      </span>
      <span className="block text-[11px] font-normal text-gray-400 dark:text-gray-500 break-words">
        {meeting.summary}
      </span>
      <span className="mt-1 inline-block px-2 py-0.5 rounded-full bg-band shadow-soft-inset text-[10px] font-normal text-gray-500 dark:text-gray-400">
        {KIND_LABELS[meeting.kind as ScheduleKind] ?? meeting.kind}
      </span>
    </th>
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
