import type { ScheduleKind } from '@/types'

/**
 * The parts an absence form and a meeting form genuinely share (teams.md §3.4).
 *
 * Absences and meetings carry **identical scheduling fields** and are entered
 * through one modal shape, so the three kind tabs, the field wrapper and the
 * far-future check live here rather than being written twice and drifting. What
 * is deliberately *not* shared is the rest of each form: an absence names which
 * halves it covers, a meeting names the half it *starts* in plus a duration, and
 * folding those into one component would produce a form with fields that do
 * nothing for whichever kind of entry is open.
 */

export const inputClass =
  'mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm'

interface FieldProps {
  readonly label: string
  readonly htmlFor: string
  readonly hint?: string
  readonly children: React.ReactNode
}

/**
 * A labelled control that stays level with its neighbour.
 *
 * Fields sit two to a row, and their labels carry hints of very different
 * lengths — "First occurrence · the anchor — it picks the weeks" wraps to two
 * lines beside a one-line "Until". Laid out naively, each control simply follows
 * its own label and the two inputs on a row start at different heights, which
 * reads as a mistake even though nothing is wrong.
 *
 * So the field fills its grid cell and the control is pushed to the bottom of
 * it: the row's tallest label sets the height, and every control on that row
 * shares one baseline no matter how its label wrapped. Doing it here rather than
 * with `items-end` on each grid means a row added later cannot forget.
 */
export function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className="flex h-full flex-col">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {hint && <span className="ml-1 text-xs font-normal text-gray-400">{hint}</span>}
      </label>
      <div className="mt-auto">{children}</div>
    </div>
  )
}

export const KIND_LABELS: Readonly<Record<ScheduleKind, string>> = {
  range: 'Range',
  weekly: 'Weekly',
  interval: 'Interval',
}

const ORDER: readonly ScheduleKind[] = ['range', 'weekly', 'interval']

interface KindTabsProps {
  readonly label: string
  readonly value: ScheduleKind
  readonly onChange: (kind: ScheduleKind) => void
  /** What each kind is for, in this form's vocabulary — they differ by entry. */
  readonly hints: Readonly<Record<ScheduleKind, string>>
}

/**
 * Three named kinds, not one kind with a number.
 *
 * `interval` is its own choice rather than "every [1] weeks" on `weekly`, so the
 * common case has nothing to fill in: three named choices ask a question people
 * can answer, one choice plus a parameter asks them to encode an answer (§3.4).
 */
export function KindTabs({ label, value, onChange, hints }: KindTabsProps) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">Kind</span>
      <div
        role="tablist"
        aria-label={label}
        className="mt-1 flex gap-1 p-1 rounded-lg bg-band shadow-soft-inset"
      >
        {ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={value === kind}
            title={hints[kind]}
            onClick={() => onChange(kind)}
            className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
              value === kind
                ? 'bg-canvas shadow-soft-sm text-blue-600 dark:text-blue-400 font-medium'
                : 'text-gray-600 dark:text-gray-300 hover:bg-canvas/60'
            }`}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** spec/teams.md §9: beyond ten years warns; nothing ever refuses a date. */
export const FAR_FUTURE_YEARS = 10

export function isFarFuture(iso: string): boolean {
  if (!iso) return false
  const limit = new Date()
  limit.setFullYear(limit.getFullYear() + FAR_FUTURE_YEARS)
  return iso > limit.toISOString().slice(0, 10)
}
