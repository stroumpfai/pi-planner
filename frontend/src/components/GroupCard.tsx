import { useDraggable } from '@dnd-kit/core'
import { usePBIs } from '@/hooks/usePBIs'
import { useDeleteGroup, useUpdateGroup } from '@/hooks/useSwimlinesAndGroups'
import { useAuthStore } from '@/stores/authStore'
import type { Group } from '@/types'

export interface GroupDragData {
  type: 'group'
  groupId: string
  swimlaneId: string
  fromSprintIndex: number | null
}

interface Props {
  readonly group: Group
  readonly projectId: string
}

const SPRINT_LABELS = ['S1', 'S2', 'S3', 'S4', 'S5']

export function GroupCard({ group, projectId }: Props) {
  const isEditing = useAuthStore((s) => s.isEditing)
  const deleteGroup = useDeleteGroup(group.swimline_id)
  const updateGroup = useUpdateGroup(group.swimline_id)

  const { data: allPbis } = usePBIs(projectId, group.feature_system_id)
  const groupPbis = allPbis?.filter((p) => p.group_id === group.system_id) ?? []
  const totalEffort = groupPbis.reduce((sum, p) => sum + (p.effort ?? 0), 0)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group:${group.system_id}`,
    data: {
      type: 'group',
      groupId: group.system_id,
      swimlaneId: group.swimline_id,
      fromSprintIndex: group.sprint_index,
    } satisfies GroupDragData,
  })

  const sprintLabel = group.sprint_index != null ? SPRINT_LABELS[group.sprint_index] : null

  function handleUngroup() {
    deleteGroup.mutate(group.system_id)
  }

  function handleMoveSprint(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    updateGroup.mutate({
      groupId: group.system_id,
      body: { sprint_index: val === '' ? null : Number(val) },
    })
  }

  return (
    <div
      ref={setNodeRef}
      className={`bg-white border rounded-md shadow-sm transition-opacity ${
        isDragging ? 'opacity-40 border-blue-400' : 'border-gray-200'
      }`}
    >
      {/* Drag handle + name row */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing border-b border-gray-100"
        {...attributes}
        {...listeners}
      >
        <span className="text-xs font-semibold text-gray-800 flex-1 truncate">{group.name}</span>
        {totalEffort > 0 && (
          <span className="flex-shrink-0 text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium">
            {totalEffort}pt
          </span>
        )}
        {sprintLabel && (
          <span className="flex-shrink-0 text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">
            {sprintLabel}
          </span>
        )}
      </div>

      {/* PBI list */}
      {groupPbis.length > 0 && (
        <ul className="px-2 py-1 space-y-0.5">
          {groupPbis.map((pbi) => (
            <li key={pbi.system_id} className="text-xs text-gray-600 truncate">
              {pbi.id != null && <span className="font-mono text-gray-400">[{pbi.id}] </span>}
              {pbi.title}
            </li>
          ))}
        </ul>
      )}

      {/* Actions */}
      {isEditing && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-gray-100">
          <select
            value={group.sprint_index ?? ''}
            onChange={handleMoveSprint}
            className="text-xs border-0 bg-transparent text-gray-500 focus:outline-none cursor-pointer flex-1"
            title="Assign to sprint"
          >
            <option value="">Unassigned</option>
            {SPRINT_LABELS.map((label, i) => (
              <option key={i} value={i}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleUngroup}
            disabled={deleteGroup.isPending}
            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 flex-shrink-0"
            title="Ungroup (PBIs remain)"
          >
            Ungroup
          </button>
        </div>
      )}
    </div>
  )
}
