import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useUpdateSprint } from '@/hooks/useSprints'
import type { Sprint } from '@/types'

interface Props {
  readonly open: boolean
  readonly sprint: Sprint
  readonly piId: string
  readonly onClose: () => void
}

export function SprintCapacityModal({ open, sprint, piId, onClose }: Props) {
  const [capacity, setCapacity] = useState(String(sprint.capacity ?? 0))
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateSprint(piId)

  function handleClose() {
    setCapacity(String(sprint.capacity ?? 0))
    setError(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = parseInt(capacity, 10)
    if (isNaN(val) || val < 0) {
      setError('Capacity must be 0 or greater')
      return
    }
    setError(null)
    try {
      await update.mutateAsync({ sprintId: sprint.system_id, body: { capacity: val || 1 } })
      handleClose()
    } catch {
      setError('Failed to update capacity')
    }
  }

  const label = `Sprint ${(sprint.sprint_index ?? 0) + 1}`

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-lg shadow-xl p-6 w-72">
          <Dialog.Title className="text-base font-semibold text-gray-900 mb-4">
            {label} Capacity
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="sprint-capacity" className="block text-sm font-medium text-gray-700 mb-1">
                Capacity (story points)
              </label>
              <input
                id="sprint-capacity"
                type="number"
                min="0"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                autoFocus
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={handleClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
              <button
                type="submit"
                disabled={update.isPending}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
