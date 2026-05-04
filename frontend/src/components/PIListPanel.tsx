import { useState } from 'react'
import { usePIs, useDeletePI } from '@/hooks/usePIs'
import { useAuthStore } from '@/stores/authStore'
import { PIStateBadge } from './PIStateBadge'
import { PIStateButton } from './PIStateButton'
import { CreatePIModal } from './CreatePIModal'
import { ConfirmDialog } from './ConfirmDialog'
import type { PI } from '@/types'

interface Props {
  projectId: string
}

export function PIListPanel({ projectId }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PI | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  const isEditing = useAuthStore((s) => s.isEditing)

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
        {isLoading ? (
          <p className="text-xs text-gray-400 px-4 py-3">Loading…</p>
        ) : pis?.length === 0 ? (
          <p className="text-xs text-gray-400 px-4 py-4">No PIs yet</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pis?.map((pi) => (
              <li key={pi.system_id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{pi.name}</span>
                  <PIStateBadge state={pi.state as 'draft' | 'in_progress' | 'closed'} />
                </div>

                {(pi.start_date || pi.end_date) && (
                  <p className="text-xs text-gray-400">
                    {pi.start_date ?? '?'} → {pi.end_date ?? '?'}
                  </p>
                )}

                {isEditing && (
                  <div className="flex items-center gap-2">
                    <PIStateButton
                      pi={pi}
                      projectId={projectId}
                      onError={setStateError}
                    />
                    <button
                      onClick={() => setDeleteTarget(pi)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreatePIModal
        open={showCreate}
        projectId={projectId}
        onClose={() => setShowCreate(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete PI"
        description={`"${deleteTarget?.name}" and all its swimlanes will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) deletePI.mutate(deleteTarget.system_id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
