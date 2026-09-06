import type { FirstPatternVersion, PatternVersion } from '@/types'

/**
 * The vocabulary of a working pattern (teams.md §3.3).
 *
 * A pattern is 14 booleans — Mon–Sun × am/pm — plus a day length and a focus,
 * all of them versioned by date. Everything here is about the 14: the app names
 * them in one place so the grid, the create form and the API payload cannot
 * drift apart on spelling or on which day the week starts.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const HALVES = ['am', 'pm'] as const
export type Half = (typeof HALVES)[number]

export type HalfDayKey = `${Weekday}_${Half}`

export const HALF_DAY_KEYS: readonly HalfDayKey[] = WEEKDAYS.flatMap((day) =>
  HALVES.map((half) => `${day}_${half}` as HalfDayKey),
)

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

export type HalfDayMap = Record<HalfDayKey, boolean>

function build(on: (key: HalfDayKey) => boolean): HalfDayMap {
  return Object.fromEntries(HALF_DAY_KEYS.map((key) => [key, on(key)])) as HalfDayMap
}

const WEEKEND: readonly Weekday[] = ['sat', 'sun']

export const isWeekend = (day: Weekday) => WEEKEND.includes(day)

/** Mon–Fri, both halves — the contract most people are on. */
export const FULL_WEEK: HalfDayMap = build((key) => !isWeekend(key.split('_')[0] as Weekday))

/** The 14 booleans of a stored version, as a map the grid can index. */
export function halvesOf(version: PatternVersion | FirstPatternVersion): HalfDayMap {
  return build((key) => Boolean(version[key]))
}

export function countHalfDays(halves: HalfDayMap): number {
  return HALF_DAY_KEYS.filter((key) => halves[key]).length
}

/**
 * One-click contracts for the create form (§3.3).
 *
 * "Copy from…" is the third and is not here: it copies a real member's version
 * rather than a fixed shape, so it belongs to the form that can see the team.
 */
export const PATTERN_PRESETS: readonly { readonly label: string; readonly halves: HalfDayMap }[] = [
  { label: 'Full week', halves: FULL_WEEK },
  {
    label: '80% — Fri off',
    halves: build((key) => {
      const day = key.split('_')[0] as Weekday
      return !isWeekend(day) && day !== 'fri'
    }),
  },
]

/**
 * The focus values a select offers: 0.1–1.0 in steps of 0.05 (§3.3, §9).
 *
 * Built rather than written out, and rounded at each step: 0.1 + 0.05 × n
 * accumulates float error that the API's step check would then reject.
 */
export const FOCUS_STEPS: readonly number[] = Array.from(
  { length: 19 },
  (_, index) => Math.round((0.1 + index * 0.05) * 100) / 100,
)

/** Today as `YYYY-MM-DD` in the user's own timezone, which is the date they mean. */
export function todayIso(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}
