import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import { ConfirmDialog } from './ConfirmDialog'
import {
  useSnapshots,
  useCreateSnapshot,
  useDeleteSnapshot,
  useRestoreSnapshot,
} from '@/hooks/useSnapshots'
import type { Snapshot } from '@/types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function defaultSnapshotName(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Snapshot ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// ── CreateSnapshotForm ───────────────────────────────────────────────────────

interface CreateSnapshotFormProps {
  readonly projectId: string
}

function CreateSnapshotForm({ projectId }: CreateSnapshotFormProps) {
  const [name, setName] = useState('')
  const createSnapshot = useCreateSnapshot(projectId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim() || defaultSnapshotName()
    createSnapshot.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          toast.success('Snapshot created')
          setName('')
        },
        onError: () => toast.error('Failed to create snapshot'),
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border border-blue-200 rounded-md bg-blue-50 px-4 py-3">
      <div className="flex-1">
        <label htmlFor="snapshot-name" className="block text-xs font-medium text-gray-600 mb-1">
          Snapshot name
        </label>
        <input
          id="snapshot-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultSnapshotName()}
          maxLength={255}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={createSnapshot.isPending}
        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
      >
        {createSnapshot.isPending ? 'Creating…' : 'Create Snapshot'}
      </button>
    </form>
  )
}

// ── SnapshotRow ──────────────────────────────────────────────────────────────

interface SnapshotRowProps {
  readonly projectId: string
  readonly snapshot: Snapshot
  readonly canEdit: boolean
}

function SnapshotRow({ projectId, snapshot, canEdit }: SnapshotRowProps) {
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const queryClient = useQueryClient()

  const restoreSnapshot = useRestoreSnapshot(projectId)
  const deleteSnapshot = useDeleteSnapshot(projectId)

  const handleRestore = () => {
    setConfirmRestore(false)
    restoreSnapshot.mutate(snapshot.system_id, {
      onSuccess: () => toast.success(`Project restored from "${snapshot.name}"`),
      onError: () => toast.error('Failed to restore snapshot'),
    })
  }

  const handleDelete = () => {
    setConfirmDelete(false)
    deleteSnapshot.mutate(snapshot.system_id, {
      onSuccess: () => {
        toast.success(`Deleted snapshot "${snapshot.name}"`)
        queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })
      },
      onError: () => toast.error('Failed to delete snapshot'),
    })
  }

  const busy = restoreSnapshot.isPending || deleteSnapshot.isPending

  return (
    <>
      <div className="border border-gray-200 rounded-md px-4 py-3 bg-white flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{snapshot.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Created: {formatDateTime(snapshot.created_at)}
            {snapshot.created_by ? ` · by ${snapshot.created_by}` : ''}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmRestore(true)}
              disabled={busy}
              className="px-3 py-1 text-xs font-medium text-blue-600 bg-white border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-40"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="px-3 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRestore}
        title={`Restore "${snapshot.name}"?`}
        description="This will overwrite ALL current project data — PIs, features, PBIs, swimlanes, sprints and groups — with the contents of this snapshot. A safety snapshot of the current state will be taken automatically before restoring, so you can undo this if needed."
        confirmLabel="Restore"
        onConfirm={handleRestore}
        onCancel={() => setConfirmRestore(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${snapshot.name}"?`}
        description="This will permanently delete this snapshot. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

// ── SnapshotsModal ───────────────────────────────────────────────────────────

interface Props {
  readonly projectId: string
  readonly open: boolean
  readonly onClose: () => void
}

export function SnapshotsModal({ projectId, open, onClose }: Props) {
  const canEdit = useAuthStore((s) => s.canEdit())
  const queryClient = useQueryClient()
  const { data: snapshots = [], isLoading, isError } = useSnapshots(projectId, open)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-base font-semibold text-gray-900">Snapshots</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Capture the full state of this project and restore it later. Restoring overwrites all current data
            (a safety snapshot is taken automatically first).
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {isLoading && (
              <p className="text-sm text-gray-500 py-4 text-center">Loading…</p>
            )}

            {isError && (
              <div className="text-sm text-red-600 py-4 text-center space-y-2">
                <p>Failed to load snapshots.</p>
                <button
                  type="button"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })}
                  className="text-xs underline hover:no-underline"
                >
                  Retry
                </button>
              </div>
            )}

            {!isLoading && !isError && snapshots.length === 0 && (
              <p className="text-sm text-gray-400 italic text-center py-4">No snapshots yet.</p>
            )}

            {!isLoading && !isError && snapshots.map((snapshot) => (
              <SnapshotRow
                key={snapshot.system_id}
                projectId={projectId}
                snapshot={snapshot}
                canEdit={canEdit}
              />
            ))}
          </div>

          {canEdit && (
            <div className="pt-4 mt-2 border-t border-gray-100 shrink-0">
              <CreateSnapshotForm projectId={projectId} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
