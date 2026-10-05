import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useSetHolidayException } from '@/hooks/useHolidays'
import { holidayErrorMessage } from '@/services/holidays'
import type { TeamHolidayEntry, TeamMember } from '@/types'
import { holidaySpan } from '@/utils/holidayGrid'

interface Props {
  readonly teamId: string
  readonly member: TeamMember | null
  readonly entries: readonly TeamHolidayEntry[]
  readonly date: string
  readonly canEdit: boolean
  readonly onClose: () => void
}

/**
 * A member's holiday on one day, and whether they work it (public-holidays.md §5.3).
 *
 * One toggle per holiday covering the day: two calendars can both name it, and
 * working one does not mean working the other. The exception covers the whole
 * day, because a day is what was clicked (§3.5).
 */
export function HolidayDayDialog({ teamId, member, entries, date, canEdit, onClose }: Props) {
  const setException = useSetHolidayException(teamId)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (entry: TeamHolidayEntry, works: boolean) => {
    if (!member) return
    setError(null)
    try {
      await setException.mutateAsync({ memberId: member.system_id, entryId: entry.system_id, day: date, works })
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not save that — please try again.'))
    }
  }

  return (
    <Dialog.Root open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-full max-w-sm">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {member?.name} · {date}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Public holiday from the team&apos;s calendars.
          </Dialog.Description>
          <ul className="mt-3 space-y-3">
            {entries.map((entry) => {
              const works = entry.exceptions.some((e) => e.member_id === member?.system_id && e.day === date)
              return (
                <li key={entry.system_id} className="text-sm">
                  <p className="font-medium text-gray-800 dark:text-gray-100">{entry.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {entry.calendar_name} · {holidaySpan(entry)}
                  </p>
                  {canEdit ? (
                    <label className="mt-1 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={works}
                        disabled={setException.isPending}
                        onChange={() => toggle(entry, !works)}
                      />
                      Works this day
                    </label>
                  ) : (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {works ? 'Works this day' : 'Off for the holiday'}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button type="button" className="px-3 py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
