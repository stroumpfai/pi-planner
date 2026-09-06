import { useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { AddMemberModal } from '@/components/AddMemberModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EditMemberModal } from '@/components/EditMemberModal'
import { MEMBER_COLUMNS, MEMBER_COLUMNS_READER, TeamMemberRow } from '@/components/TeamMemberRow'
import { useDeleteMember, useReorderMembers, useTeamMembers } from '@/hooks/useTeamMembers'
import { MEMBER_CHANGED_MESSAGE, memberErrorCode } from '@/services/teamMembers'
import { useAuthStore } from '@/stores/authStore'
import type { TeamMember } from '@/types'

interface Props {
  readonly teamId: string
  /** Open Working days on this member — where hours and focus are actually set. */
  readonly onOpenWorkingDays: (memberId: string) => void
}

/**
 * The team's people (teams.md §7.2).
 *
 * Rows are reorderable by drag **and** by the arrow buttons beside each one. The
 * duplication is deliberate: order is a preference people set rarely and often
 * from a keyboard, and a pointer-only gesture would leave it unreachable for some
 * of them.
 */
export function TeamMembersView({ teamId, onOpenWorkingDays }: Props) {
  const { data: members, isLoading } = useTeamMembers(teamId)
  const canEdit = useAuthStore((s) => s.canEdit())
  const reorder = useReorderMembers(teamId)
  const remove = useDeleteMember(teamId)

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [deleting, setDeleting] = useState<TeamMember | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const rows = members ?? []

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return
    const order = rows.map((m) => m.system_id)
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    reorder.mutate(order)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(
      rows.findIndex((m) => m.system_id === active.id),
      rows.findIndex((m) => m.system_id === over.id),
    )
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteError(null)
    try {
      await remove.mutateAsync({ memberId: deleting.system_id, etag: deleting.etag ?? '' })
      setDeleting(null)
    } catch (err) {
      setDeleteError(
        memberErrorCode(err) === 'STALE'
          ? MEMBER_CHANGED_MESSAGE
          : 'Could not remove this member — please try again.',
      )
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* The Meetings header, exactly: what the view is, the one thing you can
          add to it, and then the caption pushed to the far side. The add button
          belongs next to the title rather than across the page from it — it acts
          on this view, and at the right edge it read as a page-level action. The
          count moves into the caption slot, which is where a fact about the list
          rather than a control belongs. */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Members</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-blue-600 hover:shadow-soft-hover"
          >
            + Add member
          </button>
        )}
        <p className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {rows.length === 1 ? '1 member' : `${rows.length} members`}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading members…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">No members yet — capacity will read 0 until someone is added.</p>
          {canEdit && (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Add the first member
            </button>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((m) => m.system_id)} strategy={verticalListSortingStrategy}>
            {/* Sized to its columns, like the meetings matrix and the working
                days list: the card ends where the last column does. */}
            <div className="w-fit max-w-full shadow-soft rounded-xl bg-canvas overflow-hidden">
              {/* The uppercase rule the design puts above every table — without it
                  "8.0 h · since 01.09.26" is a chip with nothing naming it. */}
              <div
                aria-hidden="true"
                className={`grid ${canEdit ? MEMBER_COLUMNS : MEMBER_COLUMNS_READER} gap-3 px-4 py-2 border-b border-white/60 dark:border-white/10 bg-band/30 text-[10.5px] uppercase tracking-[0.04em] text-gray-400 dark:text-gray-500`}
              >
                {canEdit && <span />}
                <span>Name</span>
                <span>Role</span>
                <span>Org</span>
                <span>Valid</span>
                <span>h/day</span>
                <span>focus</span>
                {canEdit && <span />}
              </div>
              <ul className="divide-y divide-white/60">
              {rows.map((member, index) => (
                <TeamMemberRow
                  key={member.system_id}
                  member={member}
                  canEdit={canEdit}
                  isFirst={index === 0}
                  isLast={index === rows.length - 1}
                  onEdit={() => setEditing(member)}
                  onDelete={() => { setDeleteError(null); setDeleting(member) }}
                  onMoveUp={() => move(index, index - 1)}
                  onMoveDown={() => move(index, index + 1)}
                  onOpenWorkingDays={() => onOpenWorkingDays(member.system_id)}
                />
              ))}
              </ul>
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddMemberModal open={adding} teamId={teamId} members={rows} onClose={() => setAdding(false)} />

      {editing && (
        <EditMemberModal
          open
          teamId={teamId}
          member={editing}
          members={rows}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          destructive
          title={`Remove ${deleting.name}?`}
          description={cascadeWarning(deleting)}
          confirmLabel="Remove"
          error={deleteError}
          confirmDisabled={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/**
 * What goes with them, counted (teams.md §10).
 *
 * The counts are on the row already, so the dialog can be specific rather than
 * warning in the abstract — and it names the alternative, because "they left" is
 * almost always `active_to`, not a delete: past sprints computed from their time
 * would otherwise change.
 */
function cascadeWarning(member: TeamMember): string {
  const parts = [plural(member.version_dates?.length ?? 0, 'working-pattern version')]
  if ((member.absence_count ?? 0) > 0) parts.push(plural(member.absence_count ?? 0, 'absence', 'absences'))
  if ((member.meeting_count ?? 0) > 0) parts.push(plural(member.meeting_count ?? 0, 'meeting'))
  return (
    `This also deletes their ${parts.join(', ')}, and changes capacity for sprints already ` +
    'planned. If they have simply left, set their "until" date instead — that keeps the history.'
  )
}

function plural(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`
}
