import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { usePBIs, useUpdatePBI } from '@/hooks/usePBIs'
import { useEffortUnit } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { PBIFormModal } from './PBIFormModal'
import type { PBI } from '@/types'
import type { PBIDragData } from './PBIRow'

interface Props {
  readonly featureId: string
  readonly projectId: string
  readonly selectedIds: Set<string>
  readonly onToggle: (pbiId: string) => void
  readonly swimlaneId?: string
  readonly canDragToSprint?: boolean
}

function PBISelectRow({ pbi, projectId, selected, onToggle, swimlaneId, canDragToSprint }: {
  readonly pbi: PBI
  readonly projectId: string
  readonly selected: boolean
  readonly onToggle: () => void
  readonly swimlaneId: string
  readonly canDragToSprint: boolean
}) {
  const showIds = useSettingsStore((s) => s.showIds)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const effortUnit = useEffortUnit(projectId)
  const isEditing = useAuthStore((s) => s.isEditing)
  const updatePBI = useUpdatePBI(projectId)
  const [editing, setEditing] = useState(false)
  const displayId = showIds && pbi.id != null ? `[${pbi.id}] ` : ''
  const isGrouped = pbi.group_id != null
  const isBug = pbi.item_type === 'bug'
  const draggable = canDragToSprint && !isGrouped
  const unitSuffix = showEffortUnit ? effortUnit : ''
  const effortLabel = pbi.effort == null ? null : `${pbi.effort}${unitSuffix}`

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pbi:${pbi.system_id}`,
    disabled: !draggable,
    data: {
      type: 'pbi',
      pbiId: pbi.system_id,
      pbiLabel: pbi.title,
      featureId: pbi.parent_feature_system_id,
      swimlaneId,
    } satisfies PBIDragData,
  })

  return (
    <div ref={setNodeRef} className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50${isDragging ? ' opacity-40' : ''}`}>
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing text-xs w-3 shrink-0 select-none"
          title="Drag to sprint"
        >⠿</button>
      )}
      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={isGrouped}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
        />
        {isBug && (
          <span className="flex-shrink-0 text-xs font-medium bg-red-50 text-red-600 border border-red-200 px-1.5 rounded">
            Bug
          </span>
        )}
        <span
          className={`text-xs line-clamp-2 ${isGrouped ? 'text-gray-400' : 'text-gray-700'}`}
          title={pbi.title}
        >
          {displayId && <span className="font-mono text-gray-400">{displayId}</span>}
          {pbi.title}
        </span>
      </label>
      {isEditing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit"
          title="Edit"
          className="flex-shrink-0 text-xs text-gray-400 hover:text-blue-600"
        >✎</button>
      )}
      {effortLabel && (
        <span className="flex-shrink-0 text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
          {effortLabel}
        </span>
      )}
      {isGrouped && (
        <span className="flex-shrink-0 text-xs text-gray-400 italic">grouped</span>
      )}
      <PBIFormModal
        open={editing}
        pbi={pbi}
        onClose={() => setEditing(false)}
        onSubmit={(values) => updatePBI.mutateAsync({ pbiId: pbi.system_id, body: values })}
      />
    </div>
  )
}

export function PBISelectList({ featureId, projectId, selectedIds, onToggle, swimlaneId = '', canDragToSprint = false }: Props) {
  const { data: pbis, isLoading } = usePBIs(projectId, featureId)

  if (isLoading) return <p className="text-xs text-gray-400 px-2 py-1">Loading…</p>
  if (!pbis?.length) return <p className="text-xs text-gray-300 px-2 py-1">No PBIs</p>

  return (
    <div className="space-y-0.5">
      {pbis.map((pbi) => (
        <PBISelectRow
          key={pbi.system_id}
          pbi={pbi}
          projectId={projectId}
          selected={selectedIds.has(pbi.system_id)}
          onToggle={() => onToggle(pbi.system_id)}
          swimlaneId={swimlaneId}
          canDragToSprint={canDragToSprint}
        />
      ))}
    </div>
  )
}
