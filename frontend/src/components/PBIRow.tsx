import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { PBI } from '@/types'
import { PBIFormModal } from './PBIFormModal'
import { ConfirmDialog } from './ConfirmDialog'
import { useUpdatePBI, useDeletePBI } from '@/hooks/usePBIs'
import { useAuthStore } from '@/stores/authStore'

export interface PBIDragData {
  type: 'pbi'
  pbiId: string
  pbiLabel: string
  featureId: string
  swimlaneId: string
}

interface Props {
  readonly pbi: PBI
  readonly projectId: string
  readonly swimlaneId?: string
  readonly isDraggable?: boolean
}

export function PBIRow({ pbi, projectId, swimlaneId = '', isDraggable = false }: Props) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isEditing = useAuthStore((s) => s.isEditing)

  const updatePBI = useUpdatePBI(projectId)
  const deletePBI = useDeletePBI(projectId)

  const displayId = pbi.id == null ? '' : `[${pbi.id}] `
  const effortLabel = pbi.effort == null ? null : `${pbi.effort}pts`
  const isBug = pbi.item_type === 'bug'

  const canDrag = isDraggable && isEditing
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pbi:${pbi.system_id}`,
    disabled: !canDrag,
    data: {
      type: 'pbi',
      pbiId: pbi.system_id,
      pbiLabel: pbi.title,
      featureId: pbi.parent_feature_system_id,
      swimlaneId,
    } satisfies PBIDragData,
  })

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 py-1.5 pr-2 group${isDragging ? ' opacity-40' : ''}`}
    >
      {canDrag && (
        <span
          {...attributes}
          {...listeners}
          className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing text-xs w-3 shrink-0 select-none"
          title="Drag to sprint"
        >⠿</span>
      )}

      {isBug
        ? <span className="text-red-400 text-xs w-3 shrink-0" title="Bug">⬤</span>
        : <span className="text-gray-300 text-xs w-3 shrink-0">○</span>
      }

      <span className="flex-1 text-sm text-gray-700 truncate">
        {displayId && <span className="font-mono text-gray-400 text-xs">{displayId}</span>}
        {pbi.title}
      </span>

      {isBug && (
        <span className="text-xs font-medium bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded shrink-0">
          Bug
        </span>
      )}

      {effortLabel && (
        <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
          {effortLabel}
        </span>
      )}

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => isEditing && setEditing(true)}
          disabled={!isEditing}
          title={isEditing ? 'Edit' : 'Request Edit Mode to make changes'}
          className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          Edit
        </button>
        <button
          onClick={() => isEditing && setConfirming(true)}
          disabled={!isEditing}
          title={isEditing ? 'Delete' : 'Request Edit Mode to make changes'}
          className="text-xs text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed"
        >
          Delete
        </button>
      </div>

      <PBIFormModal
        open={editing}
        pbi={pbi}
        onClose={() => setEditing(false)}
        onSubmit={(values) => updatePBI.mutateAsync({ pbiId: pbi.system_id, body: values })}
      />

      <ConfirmDialog
        open={confirming}
        title="Delete PBI"
        description={`"${pbi.title}" will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { deletePBI.mutate(pbi.system_id); setConfirming(false) }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
