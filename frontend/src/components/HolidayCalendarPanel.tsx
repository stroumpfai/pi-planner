import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useHolidayCalendars, useSetCalendarEnabled } from '@/hooks/useHolidays'
import { holidayErrorMessage } from '@/services/holidays'
import { useUiStore } from '@/stores/uiStore'
import type { HolidayCalendarSummary, TeamHolidayEntry } from '@/types'

interface Props {
  readonly teamId: string
  readonly enabledIds: readonly string[]
  /** The enabled calendars' entries in the visible months, for each line's count. */
  readonly visibleEntries: readonly TeamHolidayEntry[]
  readonly canEdit: boolean
  readonly onCleanup: () => void
}

/**
 * Which shared holiday calendars this team observes — ticked the way Outlook's
 * sidebar ticks shared calendars (public-holidays.md §5.1).
 *
 * **Every tick warns first.** The switch is undated, so enabling or disabling a
 * calendar restates capacity for every sprint it touches, closed ones included
 * (§3.4). Sprint Available is never rewritten — a derived project reads stale
 * until someone pushes — but the figures in the team views move at once.
 */
export function HolidayCalendarPanel({ teamId, enabledIds, visibleEntries, canEdit, onCleanup }: Props) {
  const { data: calendars, isLoading } = useHolidayCalendars()
  const toggle = useSetCalendarEnabled(teamId)
  const setCalendarsOpen = useUiStore((s) => s.setCalendarsOpen)
  const [pending, setPending] = useState<{ calendar: HolidayCalendarSummary; enable: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enabled = new Set(enabledIds)
  const inView = (calendarId: string) => visibleEntries.filter((e) => e.calendar_id === calendarId).length

  const confirm = async () => {
    if (!pending) return
    setError(null)
    try {
      await toggle.mutateAsync({ calendarId: pending.calendar.system_id, enabled: pending.enable })
      setPending(null)
    } catch (err) {
      setError(holidayErrorMessage(err, 'Could not change that calendar — please try again.'))
    }
  }

  return (
    <section aria-labelledby="holiday-calendars-heading" className="bg-canvas shadow-soft rounded-xl p-3">
      <div className="flex items-baseline gap-3">
        <h3 id="holiday-calendars-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Holiday calendars
        </h3>
        <button
          type="button"
          onClick={() => setCalendarsOpen(true)}
          className="text-xs text-blue-600 hover:underline"
        >
          Manage calendars
        </button>
        {canEdit && enabledIds.length > 0 && (
          <button type="button" onClick={onCleanup} className="ml-auto text-xs text-gray-500 hover:underline">
            Clean up duplicates
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="mt-2 text-xs text-gray-400">Loading calendars…</p>
      ) : (calendars ?? []).length === 0 ? (
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          No holiday calendars yet. Create one on the Calendars page, then tick it here.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {(calendars ?? []).map((calendar) => {
            const on = enabled.has(calendar.system_id)
            return (
              <li key={calendar.system_id}>
                <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    className="accent-amber-500"
                    checked={on}
                    disabled={!canEdit || toggle.isPending}
                    onChange={() => setPending({ calendar, enable: !on })}
                  />
                  {calendar.name}
                  <span className="text-gray-400 dark:text-gray-500">
                    {on ? `${inView(calendar.system_id)} in view` : `${calendar.entry_count} entries`}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.enable ? `Enable ${pending.calendar.name}` : `Disable ${pending?.calendar.name ?? ''}`}
        description="This changes capacity for every sprint of this team, including closed ones. Sprint budgets already pushed stay as they are until the next push."
        confirmLabel={pending?.enable ? 'Enable' : 'Disable'}
        error={error ?? undefined}
        confirmDisabled={toggle.isPending}
        onConfirm={confirm}
        onCancel={() => {
          setPending(null)
          setError(null)
        }}
      />
    </section>
  )
}
