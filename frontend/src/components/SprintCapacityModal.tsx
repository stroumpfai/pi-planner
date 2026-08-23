import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useUpdateSprint } from '@/hooks/useSprints'
import { DateInput } from './DateInput'
import type { Sprint } from '@/types'

interface Props {
  readonly open: boolean
  readonly sprint: Sprint
  readonly piId: string
  readonly onClose: () => void
}

export function SprintCapacityModal({ open, sprint, piId, onClose }: Props) {
  const [capacity, setCapacity] = useState(String(sprint.capacity ?? 0))
  const [startDate, setStartDate] = useState(sprint.start_date ?? '')
  const [endDate, setEndDate] = useState(sprint.end_date ?? '')
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateSprint(piId)

  function handleClose() {
    setCapacity(String(sprint.capacity ?? 0))
    setStartDate(sprint.start_date ?? '')
    setEndDate(sprint.end_date ?? '')
    setError(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = Number.parseInt(capacity, 10)
    if (Number.isNaN(val) || val < 0) {
      setError('Capacity must be 0 or greater')
      return
    }
    setError(null)
    try {
      await update.mutateAsync({
        sprintId: sprint.system_id,
        body: {
          capacity: val || 1,
          start_date: startDate || null,
          end_date: endDate || null,
        },
      })
      handleClose()
    } catch {
      setError('Failed to update sprint')
    }
  }

  const label = `Sprint ${(sprint.sprint_index ?? 0) + 1}`
  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-80"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Edit {label}
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="sprint-capacity" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Capacity (story points)
              </label>
              <input
                id="sprint-capacity"
                type="number"
                min="0"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                autoFocus
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sprint-start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start date
                </label>
                <DateInput
                  id="sprint-start"
                  value={startDate}
                  onChange={setStartDate}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="sprint-end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End date
                </label>
                <DateInput
                  id="sprint-end"
                  value={endDate}
                  onChange={setEndDate}
                  className={inputClass}
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={handleClose} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100">
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
