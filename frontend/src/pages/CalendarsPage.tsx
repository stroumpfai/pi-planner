import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CopyYearDialog } from '@/components/CopyYearDialog'
import { HolidayEntryDialog } from '@/components/HolidayEntryDialog'
import { IcsImportDialog } from '@/components/IcsImportDialog'
import {
  useCreateHolidayCalendar,
  useDeleteHolidayCalendar,
  useDeleteHolidayEntry,
  useHolidayCalendar,
  useHolidayCalendars,
  useUpdateHolidayCalendar,
} from '@/hooks/useHolidays'
import { useHolidayCalendarsSSE } from '@/hooks/useSSE'
import { holidayCalendarsApi, holidayErrorMessage } from '@/services/holidays'
import { useAuthStore } from '@/stores/authStore'
import type { HolidayCalendarDetail, HolidayEntry } from '@/types'
import { weekdayOf } from '@/utils/absenceGrid'
import { holidaySpan } from '@/utils/holidayGrid'

const WEEKDAY: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

/**
 * Shared holiday calendars (public-holidays.md §6).
 *
 * A peer of Projects and Teams rather than a part of either: a calendar belongs
 * to no team, and every team that observes the same holidays enables the same
 * one. Editing an entry here moves the capacity of every team using it, so each
 * calendar names those teams wherever a change is made.
 */
export function CalendarsPage() {
  useHolidayCalendarsSSE(true)
  const canEdit = useAuthStore((s) => s.canEdit())
  const { data: calendars, isLoading } = useHolidayCalendars()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Open the first calendar once the list arrives, and let go of a deleted one.
  useEffect(() => {
    if (!calendars) return
    if (selectedId && calendars.some((c) => c.system_id === selectedId)) return
    setSelectedId(calendars[0]?.system_id ?? null)
  }, [calendars, selectedId])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-6">
        <section aria-labelledby="calendars-heading" className="lg:w-72 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 id="calendars-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Holiday calendars
            </h2>
            {canEdit && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
              >
                + New
              </button>
            )}
          </div>
          {creating && <NewCalendarForm onDone={(id) => { setCreating(false); if (id) setSelectedId(id) }} />}
          {isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (calendars ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl p-4">
              No holiday calendars yet. Create one, add its holidays or import an .ics file, then enable
              it in a team&apos;s Absences view.
            </p>
          ) : (
            <ul className="bg-canvas shadow-soft rounded-xl divide-y divide-white/60 overflow-hidden">
              {(calendars ?? []).map((calendar) => (
                <li key={calendar.system_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(calendar.system_id)}
                    aria-current={calendar.system_id === selectedId}
                    className={`w-full text-left px-4 py-3 hover:bg-band/40 ${calendar.system_id === selectedId ? 'bg-band/60' : ''}`}
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{calendar.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {calendar.entry_count} {calendar.entry_count === 1 ? 'holiday' : 'holidays'}
                      {calendar.first_year ? ` · ${calendar.first_year}${calendar.last_year !== calendar.first_year ? `–${calendar.last_year}` : ''}` : ''}
                      {` · ${calendar.teams.length === 0 ? 'no team' : calendar.teams.map((t) => t.name).join(', ')}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex-1 min-w-0">
          {selectedId && <CalendarDetail key={selectedId} calendarId={selectedId} canEdit={canEdit} />}
        </div>
      </div>
    </div>
  )
}

function NewCalendarForm({ onDone }: { readonly onDone: (id: string | null) => void }) {
  const create = useCreateHolidayCalendar()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const created = await create.mutateAsync({ name })
      onDone(created.system_id)
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not create that calendar.'))
    }
  }

  return (
    <form onSubmit={submit} className="mb-3 bg-canvas shadow-soft rounded-xl p-3 space-y-2">
      <label htmlFor="new-calendar-name" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Calendar name
      </label>
      <input
        id="new-calendar-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        autoFocus
        placeholder="e.g. Switzerland — national"
        className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 sm:text-sm"
      />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(null)} className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
          Cancel
        </button>
        <button type="submit" disabled={!name.trim() || create.isPending} className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50">
          Create
        </button>
      </div>
    </form>
  )
}

interface DetailProps {
  readonly calendarId: string
  readonly canEdit: boolean
}

function CalendarDetail({ calendarId, canEdit }: DetailProps) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const { data: calendar, isLoading } = useHolidayCalendar(calendarId, year)
  const removeEntry = useDeleteHolidayEntry(calendarId)
  const removeCalendar = useDeleteHolidayCalendar()
  const [entryDialog, setEntryDialog] = useState<{ open: boolean; editing: HolidayEntry | null }>({ open: false, editing: null })
  const [deletingEntry, setDeletingEntry] = useState<HolidayEntry | null>(null)
  const [deletingCalendar, setDeletingCalendar] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isLoading || !calendar) return <p className="text-sm text-gray-400">Loading…</p>

  const teams = calendar.teams
  const deleteEntry = async () => {
    if (!deletingEntry) return
    setError(null)
    try {
      await removeEntry.mutateAsync({ entryId: deletingEntry.system_id, etag: deletingEntry.etag ?? '' })
      setDeletingEntry(null)
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not delete that holiday.'))
      setDeletingEntry(null)
    }
  }
  const deleteCalendar = async () => {
    setError(null)
    try {
      await removeCalendar.mutateAsync({ id: calendar.system_id, etag: calendar.etag ?? '' })
      setDeletingCalendar(false)
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not delete that calendar.'))
      setDeletingCalendar(false)
    }
  }

  return (
    <section aria-label={calendar.name} className="bg-canvas shadow-soft rounded-xl p-5 space-y-4">
      <CalendarHeader calendar={calendar} canEdit={canEdit} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
          <button type="button" aria-label="Previous year" onClick={() => setYear((y) => y - 1)} className="px-2 rounded hover:bg-band">‹</button>
          <span aria-live="polite" className="font-medium tabular-nums">{year}</span>
          <button type="button" aria-label="Next year" onClick={() => setYear((y) => y + 1)} className="px-2 rounded hover:bg-band">›</button>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <>
              <button type="button" onClick={() => setEntryDialog({ open: true, editing: null })} className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-blue-600 hover:shadow-soft-hover">
                + Add holiday
              </button>
              <button type="button" onClick={() => setCopyOpen(true)} className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-700 dark:text-gray-200 hover:shadow-soft-hover">
                Copy {year} to {year + 1}
              </button>
              <button type="button" onClick={() => setImportOpen(true)} className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-700 dark:text-gray-200 hover:shadow-soft-hover">
                Import .ics
              </button>
            </>
          )}
          <a
            href={holidayCalendarsApi.exportIcsUrl(calendar.system_id)}
            download
            className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-gray-700 dark:text-gray-200 hover:shadow-soft-hover"
          >
            Export .ics
          </a>
          {canEdit && (
            <button type="button" onClick={() => setDeletingCalendar(true)} className="px-3 py-1.5 text-xs rounded-lg bg-canvas shadow-soft-sm text-red-600 hover:shadow-soft-hover">
              Delete calendar
            </button>
          )}
        </div>
      </div>

      {calendar.entries.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">No holidays in {year}.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Holiday</th>
              <th className="py-1 font-medium">Works it</th>
              {canEdit && <th className="py-1"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {calendar.entries.map((entry) => (
              <tr key={entry.system_id} className="border-t border-white/60 dark:border-white/10">
                <td className="py-1.5 text-gray-700 dark:text-gray-200 tabular-nums">{holidaySpan(entry)}</td>
                <td className="py-1.5 text-gray-500">{WEEKDAY[weekdayOf(entry.start_date)]}</td>
                <td className="py-1.5 text-gray-900 dark:text-gray-100">{entry.label}</td>
                <td className="py-1.5 text-gray-500">{(entry.exception_days ?? []).length || '—'}</td>
                {canEdit && (
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button type="button" aria-label={`Edit ${entry.label}`} onClick={() => setEntryDialog({ open: true, editing: entry })} className="px-2 text-xs text-blue-600 hover:underline">
                      Edit
                    </button>
                    <button type="button" aria-label={`Delete ${entry.label}`} onClick={() => setDeletingEntry(entry)} className="px-2 text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      <HolidayEntryDialog
        open={entryDialog.open}
        calendarId={calendar.system_id}
        editing={entryDialog.editing}
        teams={teams}
        onClose={() => setEntryDialog({ open: false, editing: null })}
      />
      <CopyYearDialog open={copyOpen} calendarId={calendar.system_id} fromYear={year} onClose={() => setCopyOpen(false)} />
      <IcsImportDialog open={importOpen} calendarId={calendar.system_id} calendarName={calendar.name} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={deletingEntry !== null}
        title="Delete holiday"
        description={
          deletingEntry
            ? `Delete ${deletingEntry.label} (${holidaySpan(deletingEntry)})?${(deletingEntry.exception_days ?? []).length > 0 ? ` Its ${(deletingEntry.exception_days ?? []).length} "works this holiday" marks go with it.` : ''} This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={deleteEntry}
        onCancel={() => setDeletingEntry(null)}
      />
      <ConfirmDialog
        open={deletingCalendar}
        title="Delete calendar"
        description={
          teams.length > 0
            ? `Used by ${teams.map((t) => t.name).join(', ')}. Their capacity will rise for every sprint that had one of these holidays. ${calendar.name} and all its holidays will be permanently deleted.`
            : `${calendar.name} and all its holidays will be permanently deleted.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={deleteCalendar}
        onCancel={() => setDeletingCalendar(false)}
      />
    </section>
  )
}

function CalendarHeader({ calendar, canEdit }: { readonly calendar: HolidayCalendarDetail; readonly canEdit: boolean }) {
  const update = useUpdateHolidayCalendar()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(calendar.name)
  const [description, setDescription] = useState(calendar.description ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await update.mutateAsync({
        id: calendar.system_id,
        body: { name, description: description || null },
        etag: calendar.etag ?? '',
      })
      setEditing(false)
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not save — someone may have changed it. Reload and try again.'))
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-2">
        <input
          aria-label="Calendar name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-base font-semibold"
        />
        <textarea
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
          className="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
        />
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={!name.trim() || update.isPending} className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{calendar.name}</h3>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">
            Rename
          </button>
        )}
      </div>
      {calendar.description && <p className="text-sm text-gray-600 dark:text-gray-300">{calendar.description}</p>}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {calendar.teams.length === 0
          ? 'Not enabled by any team yet.'
          : `Used by ${calendar.teams.map((t) => t.name).join(', ')}.`}
      </p>
    </div>
  )
}
