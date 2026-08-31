import { HALVES, WEEKDAYS, WEEKDAY_LABELS, isWeekend, type HalfDayKey, type HalfDayMap } from '@/utils/workingDays'

interface Props {
  readonly halves: HalfDayMap
  readonly onToggle: (key: HalfDayKey, next: boolean) => void
  readonly disabled?: boolean
  /** Names the person these toggles belong to, so each button's label is unique. */
  readonly ownerLabel: string
  /** Draw the Mon…Sun captions above the toggles. The grid draws them once instead. */
  readonly showDayLabels?: boolean
}

/**
 * The 14 half-day toggles of one working pattern (teams.md §3.3).
 *
 * Half-days rather than days because that is what the contract and the capacity
 * maths both work in: someone contracted Mon–Thu plus Friday morning is ordinary,
 * and a day-level control cannot say it.
 *
 * Each toggle carries its own accessible name — "Aïcha Ben Salah Fri am" — so a
 * grid of six members has 84 buttons that are all individually addressable rather
 * than 84 buttons called "am".
 */
export function HalfDayToggles({ halves, onToggle, disabled = false, ownerLabel, showDayLabels = false }: Props) {
  return (
    <div className="flex items-end gap-2">
      {WEEKDAYS.map((day) => (
        <div key={day} className="flex flex-col items-center gap-1">
          {showDayLabels && (
            <span
              className={`text-[10px] uppercase tracking-wide ${
                isWeekend(day) ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {WEEKDAY_LABELS[day]}
            </span>
          )}
          <div className="flex gap-0.5">
            {HALVES.map((half) => {
              const key = `${day}_${half}` as HalfDayKey
              const on = halves[key]
              return (
                <button
                  key={key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${ownerLabel} ${WEEKDAY_LABELS[day]} ${half}`}
                  disabled={disabled}
                  onClick={() => onToggle(key, !on)}
                  className={`w-5 h-5 rounded-md text-[9px] font-medium transition-colors disabled:cursor-not-allowed ${
                    on
                      ? 'bg-blue-500 text-white shadow-soft-sm'
                      : 'bg-band text-gray-400 dark:text-gray-500 shadow-soft-inset'
                  } ${disabled ? 'opacity-60' : ''}`}
                  title={`${WEEKDAY_LABELS[day]} ${half}`}
                >
                  {half === 'am' ? 'a' : 'p'}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
