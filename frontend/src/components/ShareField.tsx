import type { ShareUnit } from '@/utils/shares'

interface Props {
  readonly id: string
  readonly label: string
  readonly unit: ShareUnit
  readonly value: string
  readonly onChange: (unit: ShareUnit, value: string) => void
  /** Shown when empty — "same" for a member who takes the assignment's share. */
  readonly placeholder?: string
  /** Label hidden visually, for a compact row where the member's name labels it. */
  readonly compact?: boolean
}

/**
 * A share, typed as a percentage or as days a week (teams.md §6.3.2, ADR 0010).
 *
 * Days come in half-day steps, matching how patterns and absences are entered;
 * the API refuses anything else. Switching unit keeps the number typed, because
 * guessing a conversion would need the member's contract, and the server is the
 * one that knows it.
 */
export function ShareField({ id, label, unit, value, onChange, placeholder, compact }: Props) {
  return (
    <div>
      <label
        htmlFor={id}
        className={
          compact ? 'sr-only' : 'block text-sm font-medium text-gray-700 dark:text-gray-300'
        }
      >
        {label}
      </label>
      <div className={`${compact ? '' : 'mt-1 '}flex items-center gap-2`}>
        <input
          id={id}
          name={id}
          type="number"
          step={unit === 'days' ? 0.5 : 'any'}
          min={unit === 'days' ? 0.5 : 1}
          max={unit === 'days' ? 7 : 100}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(unit, e.target.value)}
          className={`block ${compact ? 'w-20 px-2 py-0.5 text-xs' : 'w-24 sm:text-sm'} rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500`}
        />
        <select
          aria-label={`${label} unit`}
          value={unit}
          onChange={(e) => onChange(e.target.value as ShareUnit, value)}
          className={`rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 ${
            compact ? 'py-0 pl-1.5 pr-6 text-xs' : 'py-1 pl-2 pr-7 text-sm'
          }`}
        >
          <option value="pct">%</option>
          <option value="days">days a week</option>
        </select>
      </div>
    </div>
  )
}
