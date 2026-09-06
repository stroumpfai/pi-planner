import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useUpdateSprint } from '@/hooks/useSprints'
import { fmtDateTime } from '@/utils/dates'
import { DateInput } from './DateInput'
import type { ProjectPushStatus, Sprint } from '@/types'

interface Props {
  readonly open: boolean
  readonly sprint: Sprint
  readonly piId: string
  readonly onClose: () => void
  /** The project's team, when one derives its Available (teams.md §6.4). */
  readonly pushStatus?: ProjectPushStatus | null
}

/**
 * Edit one sprint's budget and dates.
 *
 * **Available goes read-only when a team derives it** (§6.4). The dates do not:
 * no team write touches them, and taking the only editor for them away would cost
 * the board something teams never claimed. Writing a derived Available here would
 * earn a 409 `AVAILABLE_IS_DERIVED` and, if it somehow landed, be reverted by the
 * next push with nothing in between to show the plan changed twice.
 */
export function SprintCapacityModal({ open, sprint, piId, onClose, pushStatus }: Props) {
  const [available, setAvailable] = useState(String(sprint.available ?? 0))
  const [startDate, setStartDate] = useState(sprint.start_date ?? '')
  const [endDate, setEndDate] = useState(sprint.end_date ?? '')
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateSprint(piId)
  const derived = pushStatus != null && pushStatus.available_source !== 'manual'

  function handleClose() {
    setAvailable(String(sprint.available ?? 0))
    setStartDate(sprint.start_date ?? '')
    setEndDate(sprint.end_date ?? '')
    setError(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = Number.parseInt(available, 10)
    if (!derived && (Number.isNaN(val) || val < 0)) {
      setError('Available must be 0 or greater')
      return
    }
    setError(null)
    try {
      await update.mutateAsync({
        sprintId: sprint.system_id,
        body: {
          // Omitted entirely on a derived sprint: sending the value back
          // unchanged would still be a write the API refuses.
          ...(derived ? {} : { available: val }),
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
              <label htmlFor="sprint-available" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Available (story points)
              </label>
              <input
                id="sprint-available"
                type="number"
                min="0"
                value={available}
                onChange={(e) => setAvailable(e.target.value)}
                autoFocus={!derived}
                readOnly={derived}
                aria-readonly={derived || undefined}
                className={derived ? `${inputClass} bg-band/60 text-gray-500 dark:text-gray-400` : inputClass}
              />
              {derived && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Derived from team {pushStatus.team_name} —{' '}
                  {sprint.available_pushed_at
                    ? `pushed ${fmtDateTime(sprint.available_pushed_at)}`
                    : 'never pushed'}
                  . Change it by updating projects from the team. The dates below are still yours.
                </p>
              )}
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
