import { fmtDate, fmtDateTime } from '@/utils/dates'
import { CapacityBar } from './CapacityBar'
import type { ProjectPushStatus, Sprint, SprintHoliday } from '@/types'
import { holidaySpan } from '@/utils/holidayGrid'

interface Props {
  readonly sprint: Sprint
  readonly usedEffort: number
  readonly unit?: string
  readonly onEditCapacity?: () => void
  /**
   * The project's team, when one derives its Available (teams.md §6.4). Null for
   * a hand-typed project, which is every project until someone opts in.
   */
  readonly pushStatus?: ProjectPushStatus | null
  /**
   * Holidays from the serving team's calendars that cost it working time in this
   * sprint (public-holidays.md §8.1). Empty, and nothing is drawn, otherwise.
   */
  readonly holidays?: readonly SprintHoliday[]
}

/**
 * One sprint column's head: its name, its dates, and its budget (§6.4, §6.6).
 *
 * The budget is where team data becomes visible inside a project, and it has two
 * shapes. **Hand-typed** is the pencil, unchanged since before teams existed.
 * **Derived** is read-only, with the team it came from and the timestamp of the
 * push that wrote it — because the number alone cannot say which it is: 14 pts
 * typed and 14 pts pushed read identically, and a stale figure has to read as
 * stale rather than as somebody's current intention.
 *
 * The pencil stays on a derived sprint — the dialog behind it still owns the
 * sprint's **dates**, which no team writes. It is the Available field inside that
 * turns read-only, so the one thing the API would refuse with 409
 * `AVAILABLE_IS_DERIVED` is also the one thing the form stops offering.
 */
export function SprintColumnHeader({ sprint, usedEffort, unit, onEditCapacity, pushStatus, holidays = [] }: Props) {
  const label = `Sprint ${(sprint.sprint_index ?? 0) + 1}`
  const dates = sprint.start_date ?? sprint.end_date
    ? `${fmtDate(sprint.start_date)} – ${fmtDate(sprint.end_date)}`
    : null
  const derived = pushStatus != null && pushStatus.available_source !== 'manual'

  return (
    <div className="p-2 border-b border-white/50 bg-canvas space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</span>
        <span className="flex items-center gap-1.5">
          {derived && (
            <span
              className="text-[10px] text-gray-400 dark:text-gray-500"
              title={`Available is derived from team ${pushStatus.team_name} and is read-only here`}
            >
              🔒 {pushStatus.team_name}
            </span>
          )}
          {onEditCapacity && (
            <button
              type="button"
              onClick={onEditCapacity}
              className="text-xs text-gray-400 hover:text-blue-500"
              title={derived ? 'Edit sprint dates' : 'Edit Available'}
            >
              ✎
            </button>
          )}
        </span>
      </div>
      {/* The chip shares the dates' row, right-aligned, so a sprint with
          holidays is no taller than its neighbours and the bars stay level. */}
      {(dates || holidays.length > 0) && (
        <div className="flex items-center justify-between gap-1 min-w-0">
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{dates}</p>
          {holidays.length > 0 && (
            <span
              className="shrink-0 text-[10px] leading-4 px-1.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              title={holidays.map((h) => `${h.label} · ${holidaySpan(h)} · ${h.calendar_name}`).join('\n')}
            >
              {holidays.length} public {holidays.length === 1 ? 'holiday' : 'holidays'}
            </span>
          )}
        </div>
      )}
      <CapacityBar used={usedEffort} available={sprint.available ?? 0} unit={unit} />
      {derived && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          {sprint.available_pushed_at
            ? `pushed ${fmtDateTime(sprint.available_pushed_at)}`
            : 'never pushed'}
        </p>
      )}
    </div>
  )
}
