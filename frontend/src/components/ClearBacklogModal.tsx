import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useClearBacklog, useClearAllFeatures } from '@/hooks/useFeatures'
import { toast } from '@/stores/toastStore'

type Mode = 'backlog' | 'all'

interface Props {
  readonly open: boolean
  readonly projectId: string
  readonly backlogCount: number
  readonly totalCount: number
  readonly onClose: () => void
}

export function ClearBacklogModal({ open, projectId, backlogCount, totalCount, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('backlog')

  const clearBacklog = useClearBacklog(projectId)
  const clearAll = useClearAllFeatures(projectId)

  const isPending = clearBacklog.isPending || clearAll.isPending

  async function handleDelete() {
    try {
      if (mode === 'backlog') {
        const result = await clearBacklog.mutateAsync()
        toast.success(`Deleted ${result.deleted_features} backlog feature${result.deleted_features === 1 ? '' : 's'}`)
      } else {
        const result = await clearAll.mutateAsync()
        toast.success(`Deleted ${result.deleted_features} feature${result.deleted_features === 1 ? '' : 's'}`)
      }
      onClose()
    } catch {
      toast.error('Delete failed. Please try again.')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-lg shadow-xl p-6 focus:outline-none"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 mb-4">
            Clear features
          </Dialog.Title>

          <div className="space-y-2 mb-4">
            <label
              className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode === 'backlog' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <input
                type="radio"
                name="clear-mode"
                value="backlog"
                checked={mode === 'backlog'}
                onChange={() => setMode('backlog')}
                className="mt-0.5 accent-blue-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Backlog only
                  <span className="ml-2 text-xs font-normal text-gray-500">({backlogCount} feature{backlogCount === 1 ? '' : 's'})</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Delete all backlog features and their PBIs. Features assigned to a PI are kept.
                </p>
              </div>
            </label>

            <label
              className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode === 'all' ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <input
                type="radio"
                name="clear-mode"
                value="all"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
                className="mt-0.5 accent-red-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Everything
                  <span className="ml-2 text-xs font-normal text-gray-500">({totalCount} feature{totalCount === 1 ? '' : 's'})</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Delete all features and PBIs in this project, including those in PIs. The board structure is kept.
                </p>
              </div>
            </label>
          </div>

          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-5">
            This action is permanent and cannot be undone.
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
