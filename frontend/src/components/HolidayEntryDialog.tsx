import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import { useCreateHolidayEntry, useUpdateHolidayEntry } from '@/hooks/useHolidays'
import { holidayErrorMessage } from '@/services/holidays'
import type { HolidayEntry, TeamRef } from '@/types'
import type { Half } from '@/utils/workingDays'

interface Props {
  readonly open: boolean
  readonly calendarId: string
  /** The entry being edited, or null for a new one. */
  readonly editing: HolidayEntry | null
  /** Who this change reaches — named, because an edit here moves their capacity (§3.4). */
  readonly teams: readonly TeamRef[]
  readonly onClose: () => void
}

const HALF_LABEL: Record<Half, string> = { am: 'morning', pm: 'afternoon' }

/**
 * Add or edit one holiday: a dated range with a starting and an ending half
 * (public-holidays.md §3.2, §6.2). There is no recurrence — next year's
 * holidays come from Copy year or an `.ics` import.
 *
 * Moving an entry deletes the "works this holiday" exceptions on days it no
 * longer covers, and the dialog says how many before saving (§3.5).
 */
export function HolidayEntryDialog({ open, calendarId, editing, teams, onClose }: Props) {
  const create = useCreateHolidayEntry(calendarId)
  const update = useUpdateHolidayEntry(calendarId)
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('')
  const [startHalf, setStartHalf] = useState<Half>('am')
  const [end, setEnd] = useState('')
  const [endHalf, setEndHalf] = useState<Half>('pm')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(editing?.label ?? '')
    setStart(editing?.start_date ?? '')
    setStartHalf((editing?.start_half as Half | undefined) ?? 'am')
    setEnd(editing?.end_date ?? '')
    setEndHalf((editing?.end_half as Half | undefined) ?? 'pm')
    setError(null)
  }, [open, editing])

  const last = end || start
  const dropped = editing
    ? (editing.exception_days ?? []).filter((day) => day < start || day > last).length
    : 0
  const saving = create.isPending || update.isPending

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const body = { label, start_date: start, start_half: startHalf, end_date: last, end_half: endHalf }
    try {
      if (editing) {
        await update.mutateAsync({ entryId: editing.system_id, body, etag: editing.etag ?? '' })
      } else {
        await create.mutateAsync(body)
      }
      onClose()
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not save that holiday — please check the dates.'))
    }
  }

  const input = 'mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm sm:text-sm'

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {editing ? 'Edit holiday' : 'Add holiday'}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {teams.length > 0
              ? `Used by ${teams.length} ${teams.length === 1 ? 'team' : 'teams'}: ${teams.map((t) => t.name).join(', ')}. Their capacity changes with this holiday.`
              : 'No team uses this calendar yet.'}
          </Dialog.Description>

          <form onSubmit={save} className="mt-4 space-y-3">
            <div>
              <label htmlFor="holiday-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Label
              </label>
              <input
                id="holiday-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={100}
                required
                className={input}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="holiday-start" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  First day
                </label>
                <DateInput id="holiday-start" value={start} onChange={setStart} className={input} />
              </div>
              <div>
                <label htmlFor="holiday-start-half" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  From the
                </label>
                <select
                  id="holiday-start-half"
                  value={startHalf}
                  onChange={(e) => setStartHalf(e.target.value as Half)}
                  className={input}
                >
                  {(['am', 'pm'] as const).map((h) => <option key={h} value={h}>{HALF_LABEL[h]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="holiday-end" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Last day
                </label>
                <DateInput id="holiday-end" value={end} onChange={setEnd} className={input} />
              </div>
              <div>
                <label htmlFor="holiday-end-half" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Until the
                </label>
                <select
                  id="holiday-end-half"
                  value={endHalf}
                  onChange={(e) => setEndHalf(e.target.value as Half)}
                  className={input}
                >
                  {(['am', 'pm'] as const).map((h) => <option key={h} value={h}>{HALF_LABEL[h]}</option>)}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Leave the last day empty for a one-day holiday.
            </p>

            {dropped > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {dropped} &ldquo;works this holiday&rdquo; {dropped === 1 ? 'mark falls' : 'marks fall'} outside the new
                dates and will be removed.
              </p>
            )}
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !label.trim() || !start}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
