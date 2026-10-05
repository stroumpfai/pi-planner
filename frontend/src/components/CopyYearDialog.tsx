import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DateInput } from '@/components/DateInput'
import { useCopyYear } from '@/hooks/useHolidays'
import { holidayCalendarsApi, holidayErrorMessage } from '@/services/holidays'
import type { CopyYearProposal, HolidayEntryFields } from '@/types'
import { weekdayOf } from '@/utils/absenceGrid'

interface Props {
  readonly open: boolean
  readonly calendarId: string
  readonly fromYear: number
  readonly onClose: () => void
}

interface Row {
  readonly proposal: CopyYearProposal
  include: boolean
  start: string
  end: string
}

const WEEKDAY_SHORT: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

/**
 * Copy a year's holidays one year on, after a review (public-holidays.md §6.3).
 *
 * **Nothing is inferred about which holidays move.** Every entry is proposed on
 * the same date a year later, and the planner corrects Easter, Ascension and
 * Whit Monday by hand, or unticks them. A proposal that lands on a weekend is
 * flagged, since that is where a fixed-date holiday most often needs a second
 * look. Exceptions are never copied.
 */
export function CopyYearDialog({ open, calendarId, fromYear, onClose }: Props) {
  const copy = useCopyYear(calendarId)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRows(null)
    setError(null)
    holidayCalendarsApi
      .previewCopyYear(calendarId, fromYear)
      .then((preview) =>
        setRows(
          preview.proposals.map((p) => ({
            proposal: p,
            include: !p.duplicate,
            start: p.start_date,
            end: p.end_date ?? p.start_date,
          })),
        ),
      )
      .catch((err) => setError(holidayErrorMessage(err, 'Could not prepare the copy.')))
  }, [open, calendarId, fromYear])

  const update = (index: number, change: Partial<Row>) =>
    setRows((current) => current?.map((row, i) => (i === index ? { ...row, ...change } : row)) ?? null)

  const confirm = async () => {
    if (!rows) return
    setError(null)
    const entries: HolidayEntryFields[] = rows
      .filter((r) => r.include)
      .map((r) => ({
        label: r.proposal.label,
        start_date: r.start,
        start_half: r.proposal.start_half,
        end_date: r.end < r.start ? r.start : r.end,
        end_half: r.proposal.end_half,
      }))
    try {
      await copy.mutateAsync(entries)
      onClose()
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not copy those holidays.'))
    }
  }

  const ticked = rows?.filter((r) => r.include).length ?? 0

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Copy {fromYear} to {fromYear + 1}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Each holiday is proposed on the same date next year. Correct the ones that move (Easter,
            Ascension, Whit Monday) or untick them. Nobody&apos;s &ldquo;works this holiday&rdquo; marks are copied.
          </Dialog.Description>

          {rows === null && !error && <p className="mt-4 text-sm text-gray-400">Preparing…</p>}
          {rows !== null && rows.length === 0 && (
            <p className="mt-4 text-sm text-gray-500">This calendar has no holidays starting in {fromYear}.</p>
          )}
          {rows !== null && rows.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                  <th className="py-1 w-8"><span className="sr-only">Copy</span></th>
                  <th className="py-1">Holiday</th>
                  <th className="py-1">{fromYear}</th>
                  <th className="py-1">First day {fromYear + 1}</th>
                  <th className="py-1">Last day</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.proposal.label}-${row.proposal.source_start_date}`} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Copy ${row.proposal.label}`}
                        checked={row.include}
                        onChange={(e) => update(index, { include: e.target.checked })}
                      />
                    </td>
                    <td className="py-1.5 text-gray-800 dark:text-gray-100">
                      {row.proposal.label}
                      {row.proposal.duplicate && (
                        <span className="block text-[11px] text-gray-400">already in {fromYear + 1}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-gray-500">{row.proposal.source_start_date}</td>
                    <td className="py-1.5">
                      <DateInput
                        id={`copy-start-${index}`}
                        value={row.start}
                        onChange={(iso) => {
                          const shift = row.end !== row.start && iso && row.start
                            ? Math.round((Date.parse(row.end) - Date.parse(row.start)) / 86_400_000)
                            : 0
                          const end = iso && shift > 0
                            ? new Date(Date.parse(iso) + shift * 86_400_000).toISOString().slice(0, 10)
                            : iso
                          update(index, { start: iso, end })
                        }}
                        className="w-32 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-sm"
                      />
                      {row.start && (
                        <span className={`ml-1 text-[11px] ${['sat', 'sun'].includes(weekdayOf(row.start)) ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                          {WEEKDAY_SHORT[weekdayOf(row.start)]}
                          {['sat', 'sun'].includes(weekdayOf(row.start)) ? ' · weekend' : ''}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <DateInput
                        id={`copy-end-${index}`}
                        value={row.end}
                        onChange={(iso) => update(index, { end: iso })}
                        className="w-32 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={ticked === 0 || copy.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            >
              Copy {ticked} {ticked === 1 ? 'holiday' : 'holidays'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
