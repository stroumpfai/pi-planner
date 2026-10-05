import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useApplyHolidayCleanup, useHolidayCleanup } from '@/hooks/useHolidays'
import { holidayErrorMessage } from '@/services/holidays'
import { holidaySpan } from '@/utils/holidayGrid'

interface Props {
  readonly teamId: string
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * Old everyone-absences a calendar now covers, offered for deletion (public-holidays.md §6.4).
 *
 * **Matched by dates, never by words, and nothing pre-ticked.** The server lists
 * range absences held by two or more members on half-days an enabled calendar
 * already covers. They cost nothing extra — holidays and absences union — so
 * deleting them only tidies the data, and only the planner decides which.
 */
export function HolidayCleanupDialog({ teamId, open, onClose }: Props) {
  const { data, isLoading } = useHolidayCleanup(teamId, open)
  const apply = useApplyHolidayCleanup(teamId)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const groups = data?.groups ?? []

  const close = () => {
    setTicked(new Set())
    setError(null)
    onClose()
  }

  const confirm = async () => {
    setError(null)
    const ids = groups.flatMap((g, i) => (ticked.has(i) ? g.members.map((m) => m.absence_id) : []))
    try {
      await apply.mutateAsync(ids)
      close()
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not delete those absences — please try again.'))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Clean up duplicate absences
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            These absences were entered for several people on days a holiday calendar now covers.
            They cost nothing extra; deleting them only tidies the list. Tick the ones to delete.
          </Dialog.Description>

          {isLoading ? (
            <p className="mt-4 text-sm text-gray-400">Looking for duplicates…</p>
          ) : groups.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No duplicates found.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {groups.map((group, index) => (
                <li key={`${group.start_date}-${group.label ?? ''}-${index}`}>
                  <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ticked.has(index)}
                      onChange={() =>
                        setTicked((current) => {
                          const next = new Set(current)
                          if (next.has(index)) next.delete(index)
                          else next.add(index)
                          return next
                        })
                      }
                    />
                    <span>
                      <span className="font-medium">{group.label || 'Unlabelled absence'}</span>
                      <span className="text-gray-500 dark:text-gray-400"> · {holidaySpan(group)}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        {group.members.map((m) => m.name).join(', ')}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={close} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={ticked.size === 0 || apply.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
            >
              Delete ticked
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
