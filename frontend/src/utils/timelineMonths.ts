/**
 * Months, and the arithmetic a minimap strip needs over them.
 *
 * Split out of `absenceGrid` once a second view — Capacity (§7.6) — grew the
 * same strip above a different table. What lives here is everything about
 * *time* that neither view owns: a month, the days it covers, how many months a
 * measured track can carry, and where a strip has to sit for a frame to be
 * inside it. What stays behind is what belongs to one view — the absence grid's
 * cells, its coverage map, its density.
 *
 * Dates are ISO strings throughout, never `Date` objects. A `Date` carries a
 * time and a timezone, and both are wrong here: 25 December is the same column
 * for everyone looking at it, and a UTC round-trip an hour either side of
 * midnight would slide a whole strip by a day.
 */

/**
 * The narrowest a month column may be drawn, and the years a strip may span.
 *
 * Whole years because the year markers have to mean something: a strip of
 * twenty-nine months ends in a marker spanning five, which reads as a rendering
 * accident rather than as a year. Snapping down is also the conservative
 * direction — a column never falls below what a month abbreviation needs.
 */
export const MIN_MONTH_COLUMN = 64
export const MIN_STRIP_YEARS = 1
export const MAX_STRIP_YEARS = 3

/** What the strip spans before anything has been measured, and on a narrow screen. */
export const DEFAULT_STRIP_MONTHS = MIN_STRIP_YEARS * 12

/**
 * What a minimap frame spans when its caller does not say.
 *
 * Both views happen to use six — the absence grid because that is what it draws,
 * the capacity table because six sprint columns are about that much time — but
 * they arrive at it for their own reasons and each passes its own number.
 */
export const DEFAULT_FRAME_MONTHS = 6

/**
 * How many months of density a track that wide can carry.
 *
 * Zero and NaN both mean "not measured yet" — the first render, and every render
 * in a test environment with no layout — and both answer with the default rather
 * than with nothing, so the strip is never momentarily empty.
 *
 * Below `12 × MIN_MONTH_COLUMN` the two rules collide and **the year wins**: the
 * strip is the navigation control and the window absences are fetched over, so
 * it spans a year even when that squeezes the columns under their floor.
 */
export function stripMonthsFor(trackWidth: number): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return DEFAULT_STRIP_MONTHS
  const columns = Math.floor(trackWidth / MIN_MONTH_COLUMN)
  const years = Math.max(MIN_STRIP_YEARS, Math.min(MAX_STRIP_YEARS, Math.floor(columns / 12)))
  return years * 12
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** A month, identified the way the pickers and the URL-free state hold it. */
export interface YearMonth {
  readonly year: number
  /** 1-based, as it reads: January is 1. */
  readonly month: number
}

export const monthOf = (iso: string): YearMonth => ({
  year: Number(iso.slice(0, 4)),
  month: Number(iso.slice(5, 7)),
})

export function addMonths({ year, month }: YearMonth, count: number): YearMonth {
  const zeroBased = year * 12 + (month - 1) + count
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 }
}

export const pad = (value: number) => String(value).padStart(2, '0')

export const firstDay = ({ year, month }: YearMonth): string => `${year}-${pad(month)}-01`

export function lastDay(ym: YearMonth): string {
  const next = addMonths(ym, 1)
  return shiftDays(firstDay(next), -1)
}

export const monthLabel = ({ year, month }: YearMonth, withYear = true): string =>
  withYear ? `${MONTH_NAMES[month - 1]} ${year}` : MONTH_NAMES[month - 1]

/** Days between two ISO dates, inclusive. Pure string arithmetic via UTC. */
export function shiftDays(iso: string, days: number): string {
  const at = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let day = from; day <= to; day = shiftDays(day, 1)) out.push(day)
  return out
}

/** Whole days from *from* to *to*, signed — the gap version of `daysBetween`. */
export function daysApart(from: string, to: string): number {
  const at = (iso: string) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((at(to) - at(from)) / 86_400_000)
}

/** The window a set of months covers, as the read's `from` / `to`. */
export function windowOf(start: YearMonth, months: number): { from: string; to: string } {
  return { from: firstDay(start), to: lastDay(addMonths(start, months - 1)) }
}

export const monthsFrom = (start: YearMonth, count: number): YearMonth[] =>
  Array.from({ length: count }, (_, index) => addMonths(start, index))

/** Whole months from *from* to *to*, signed. */
export const monthsBetween = (from: YearMonth, to: YearMonth): number =>
  (to.year - from.year) * 12 + (to.month - from.month)

/**
 * Where the minimap's strip has to sit for its frame to start on *target*.
 *
 * The strip stays put whenever it already contains the frame, and slides by the
 * least it can when it does not — so clicking a month always puts **that month**
 * where the reader asked for it, instead of being silently clamped to somewhere
 * near it. A jump that lands somewhere the user did not ask for is worse than no
 * jump at all.
 */
export function stripStartFor(
  current: YearMonth,
  target: YearMonth,
  stripMonths: number,
  frameMonths: number = DEFAULT_FRAME_MONTHS,
): YearMonth {
  const offset = monthsBetween(current, target)
  const last = stripMonths - frameMonths
  if (offset < 0) return target
  if (offset > last) return addMonths(target, -last)
  return current
}
