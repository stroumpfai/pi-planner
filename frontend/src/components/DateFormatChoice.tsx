import { useId } from 'react'
import { DATE_FORMAT_LABELS } from '@/utils/dateFormat'
import type { DateFormat } from '@/utils/dateFormat'

/** One raw cell from the file and what it reads as under the chosen format. */
export interface DateSample {
  readonly raw: string
  /** `YYYY-MM-DD`, or null when no format is chosen yet or the cell does not read. */
  readonly iso: string | null
}

interface Props {
  readonly candidates: readonly DateFormat[]
  readonly value: DateFormat | null
  readonly onChange: (format: DateFormat) => void
  readonly samples: readonly DateSample[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A date no reader can take the wrong way round: the month is spelled out.
 * Built from the ISO parts, not `Date`, so no time zone can shift it a day.
 */
function unambiguous(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`
}

/**
 * The required choice when several formats read every date in the file
 * (spec/team-achievement.md §4.3). Samples are re-read under the choice, so a wrong
 * pick shows up as a wrong month before anything is imported.
 */
export function DateFormatChoice({ candidates, value, onChange, samples }: Props) {
  const labelId = useId()
  const name = useId()

  return (
    <div className="mt-4 bg-canvas shadow-soft rounded-xl p-3">
      <p id={labelId} className="text-sm font-medium text-gray-800 dark:text-gray-100">
        Date format
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        Every date in this file fits more than one format. Which one did the exporting
        machine use?
      </p>

      <div role="radiogroup" aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {candidates.map((format) => (
          <label
            key={format}
            className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 cursor-pointer"
          >
            <input
              type="radio"
              name={name}
              value={format}
              checked={value === format}
              onChange={() => onChange(format)}
              className="accent-blue-600"
            />
            <span>{DATE_FORMAT_LABELS[format]}</span>
          </label>
        ))}
      </div>

      {samples.length > 0 && (
        <ul
          aria-label="Dates as read"
          className="mt-3 shadow-soft-inset rounded-xl px-3 py-2 space-y-0.5"
        >
          {samples.map((s) => (
            <li key={s.raw} className="text-xs text-gray-600 dark:text-gray-300 flex gap-2">
              <span className="font-mono text-gray-500 dark:text-gray-400">{s.raw}</span>
              <span aria-hidden="true">→</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">
                {s.iso === null ? '?' : unambiguous(s.iso)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
