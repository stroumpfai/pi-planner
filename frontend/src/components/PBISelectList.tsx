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
    <div ref={setNodeRef} className={`grid grid-cols-[16px_18px_minmax(0,1fr)_16px_40px] items-center pl-2 pr-1 py-1 rounded hover:bg-gray-50${isDragging ? ' opacity-40' : ''}`}>
      {/* 1. Drag handle */}
      <div className="flex items-center justify-center mr-2">
        {draggable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing text-xs w-3 shrink-0 select-none"
            title="Drag to sprint"
          >⠿</button>
        )}
      </div>

      {/* 2. Checkbox + 3. Text (Bug badge + title) */}
      <label style={{ display: 'contents' }} className="cursor-pointer">
        <div className="mr-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={isGrouped}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
          />
        </div>
        <span className="mr-2 flex items-center gap-1 min-w-0">
          {isBug && (
            <span className="shrink-0 text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-1.5 rounded">
              Bug
            </span>
          )}
          <span
            className={`line-clamp-2 text-xs ${isGrouped ? 'text-gray-400' : 'text-gray-700'}`}
            title={pbi.title}
          >
            {displayId && <span className="font-mono text-gray-400">{displayId}</span>}
            {pbi.title}
          </span>
        </span>
      </label>

      {/* 4. Edit button */}
      <div className="flex items-center justify-center">
        {isEditing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit"
            title="Edit"
            className="text-xs text-gray-400 hover:text-blue-600 flex-shrink-0"
          >✎</button>
        )}
      </div>

      {/* 5. Effort badge */}
      <div className="flex items-center justify-center">
        {effortLabel && (
          <span className="text-xs font-mono bg-band text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
            {effortLabel}
          </span>
        )}
      </div>

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
