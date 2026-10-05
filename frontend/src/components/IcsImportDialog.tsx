import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateHolidays } from '@/hooks/useHolidays'
import { holidayCalendarsApi, holidayErrorMessage } from '@/services/holidays'
import type { IcsImportResult } from '@/types'
import { holidaySpan } from '@/utils/holidayGrid'

interface Props {
  readonly open: boolean
  readonly calendarId: string
  readonly calendarName: string
  readonly onClose: () => void
}

/**
 * Merge an `.ics` file — an Outlook or Google export — into a calendar (public-holidays.md §7.1).
 *
 * **Preview first, then the same request for real.** The preview is a dry run:
 * what would be created, what is already there, and what was skipped and why
 * (a weekly rule, a task). Yearly rules are expanded over the years asked for,
 * since entries are dated. Re-importing the same file changes nothing.
 */
export function IcsImportDialog({ open, calendarId, calendarName, onClose }: Props) {
  const qc = useQueryClient()
  const thisYear = new Date().getFullYear()
  const [file, setFile] = useState<File | null>(null)
  const [fromYear, setFromYear] = useState(thisYear)
  const [toYear, setToYear] = useState(thisYear + 1)
  const [preview, setPreview] = useState<IcsImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setFile(null)
    setPreview(null)
    setError(null)
    onClose()
  }

  const run = async (dryRun: boolean) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const result = await holidayCalendarsApi.importIcs(calendarId, file, { dryRun, fromYear, toYear })
      if (dryRun) {
        setPreview(result)
      } else {
        invalidateHolidays(qc)
        close()
      }
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not read that file.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Import .ics into {calendarName}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Holidays already in the calendar are skipped, so importing the same file twice adds nothing.
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              Calendar file
              <input
                type="file"
                accept=".ics,text/calendar"
                aria-label="Calendar file"
                className="mt-1 block text-sm"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setPreview(null)
                }}
              />
            </label>
            <div className="flex items-end gap-3 text-sm text-gray-700 dark:text-gray-300">
              <label>
                Yearly holidays from
                <input
                  type="number"
                  aria-label="From year"
                  value={fromYear}
                  onChange={(e) => { setFromYear(Number(e.target.value)); setPreview(null) }}
                  className="mt-1 block w-24 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
              </label>
              <label>
                to
                <input
                  type="number"
                  aria-label="To year"
                  value={toYear}
                  onChange={(e) => { setToYear(Number(e.target.value)); setPreview(null) }}
                  className="mt-1 block w-24 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
              </label>
            </div>
          </div>

          {preview && (
            <div className="mt-4 text-sm text-gray-700 dark:text-gray-200 space-y-2" aria-label="Import preview">
              <p>
                {preview.created} to add · {preview.duplicates} already there
                {preview.skipped.length > 0 ? ` · ${preview.skipped.length} skipped` : ''}
              </p>
              {preview.entries.length > 0 && (
                <ul className="text-xs text-gray-600 dark:text-gray-300 max-h-40 overflow-y-auto">
                  {preview.entries.map((e) => (
                    <li key={`${e.label}-${e.start_date}`}>{holidaySpan(e)} · {e.label}</li>
                  ))}
                </ul>
              )}
              {preview.skipped.length > 0 && (
                <ul className="text-xs text-amber-700 dark:text-amber-400">
                  {preview.skipped.map((s, i) => <li key={`${s.summary}-${i}`}>{s.summary}: {s.reason}</li>)}
                </ul>
              )}
              {preview.truncated_labels > 0 && (
                <p className="text-xs text-gray-500">{preview.truncated_labels} long titles were shortened to 100 characters.</p>
              )}
            </div>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={close} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
              Cancel
            </button>
            {preview ? (
              <button
                type="button"
                onClick={() => run(false)}
                disabled={busy || preview.created === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                Add {preview.created}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => run(true)}
                disabled={busy || !file || toYear < fromYear}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                Preview
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
