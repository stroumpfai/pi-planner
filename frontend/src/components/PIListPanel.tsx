import { useState } from 'react'
import { fmtDate } from '@/utils/dates'
import { usePIs, useDeletePI } from '@/hooks/usePIs'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { PIStateBadge } from './PIStateBadge'
import { PIStateButton } from './PIStateButton'
import { CreatePIModal } from './CreatePIModal'
import { EditPIModal } from './EditPIModal'
import { ConfirmDialog } from './ConfirmDialog'
import type { PI } from '@/types'

interface Props {
  readonly projectId: string
}

export function PIListPanel({ projectId }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<PI | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PI | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  const isEditing = useAuthStore((s) => s.isEditing)
  const { activePIId, setActivePI } = useUiStore()

  const { data: pis, isLoading } = usePIs(projectId)
  const deletePI = useDeletePI(projectId)

  return (
    <div className="w-64 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700">Program Increments</h2>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!isEditing}
          title={isEditing ? undefined : 'Request Edit Mode to create PIs'}
          className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed font-medium"
        >
          + New PI
        </button>
      </div>

      {stateError && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex justify-between">
          <span>{stateError}</span>
          <button onClick={() => setStateError(null)} className="ml-2 text-red-500">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="text-xs text-gray-400 px-4 py-3">Loading…</p>}
        {!isLoading && pis?.length === 0 && <p className="text-xs text-gray-400 px-4 py-4">No PIs yet</p>}
        {!isLoading && !!pis?.length && (
          <ul className="divide-y divide-gray-100">
            {pis?.map((pi) => {
              const isSelected = activePIId === pi.system_id
              const selectedClass = isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
              const canEditPI = isEditing && pi.state !== 'closed'
              return (
                <li key={pi.system_id} className={selectedClass}>
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left space-y-1 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-300"
                    onClick={() => setActivePI(isSelected ? null : pi.system_id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{pi.name}</span>
                      <PIStateBadge state={pi.state as 'draft' | 'in_progress' | 'closed'} />
                    </div>
                    {(pi.start_date || pi.end_date) && (
                      <p className="text-xs text-gray-400">
                        {fmtDate(pi.start_date)} → {fmtDate(pi.end_date)}
                      </p>
                    )}
                  </button>

                  {isEditing && (
                    <div className="flex items-center gap-2 px-4 pb-3">
                      <PIStateButton
                        pi={pi}
                        projectId={projectId}
                        onError={setStateError}
                      />
                      {canEditPI && (
                        <button
                          type="button"
                          onClick={() => setEditTarget(pi)}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(pi)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <CreatePIModal
        open={showCreate}
        projectId={projectId}
        onClose={() => setShowCreate(false)}
      />

      {editTarget && (
        <EditPIModal
          open
          pi={editTarget}
          projectId={projectId}
          onClose={() => setEditTarget(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete PI"
        description={`"${deleteTarget?.name}" and all its swimlanes will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            if (activePIId === deleteTarget.system_id) setActivePI(null)
            deletePI.mutate(deleteTarget.system_id)
          }
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
