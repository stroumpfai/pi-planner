import type { Absence, TeamMember } from '@/types'
import { HALVES, WEEKDAYS, type Half, type HalfDayKey, type Weekday } from '@/utils/workingDays'

/**
 * The half-day grid's arithmetic (teams.md §7.4).
 *
 * Dates here are ISO strings throughout, never `Date` objects. A `Date` carries
 * a time and a timezone, and both are wrong for this view: 25 December is the
 * same cell for everyone looking at it, and a UTC round-trip an hour either side
 * of midnight would slide the whole grid by a day.
 */

/**
 * The grid shows six months, whatever the screen (§7.4).
 *
 * Fixed on purpose: a wider screen makes the *cells* bigger rather than showing
 * more time, so the half-day a person reads is the same size wherever they read
 * it. The strip above is the control for reaching other months.
 */
export const GRID_MONTHS = 6

/**
 * The narrowest a day may be drawn — one column, plus the rule down its left.
 *
 * A floor, not a size. Day columns flex to fill whatever width there is and stop
 * shrinking here, which is what lets the calendar fill a wide screen and scroll
 * a narrow one with no measurement at all.
 *
 * Six rather than the eight two side-by-side halves needed: a day is a single
 * column now and its halves are stacked, so the width buys one cell instead of
 * two. Six months of days fit a 1280px screen without scrolling at all.
 */
export const MIN_DAY_WIDTH = 6

/**
 * The strip spans whole years — one, two or three (§7.4).
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

const pad = (value: number) => String(value).padStart(2, '0')

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

/** 0 = Monday … 6 = Sunday, matching the backend's `weekday` field. */
export function weekdayIndex(iso: string): number {
  const at = new Date(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))),
  )
  return (at.getUTCDay() + 6) % 7
}

export const weekdayOf = (iso: string): Weekday => WEEKDAYS[weekdayIndex(iso)]

export const isWeekendDay = (iso: string) => weekdayIndex(iso) >= 5

/**
 * True on a Monday — where the calendar draws its week rule.
 *
 * The rule is what makes seven columns read as *a week* rather than as an
 * undifferentiated run of days. It is drawn as a **coloured left border that
 * every day carries**, transparent on the other six: a border only Mondays had
 * would give those columns a pixel the rest lack, and six months on the drift
 * would walk the month labels off the days they name.
 */
export const isWeekStart = (iso: string) => weekdayIndex(iso) === 0

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
 * Where the minimap's year has to sit for the grid to start on *target*.
 *
 * The strip stays put whenever it already contains the frame, and slides by the
 * least it can when it does not — so clicking a month always puts **that month
 * first** in the calendar, instead of being silently clamped to somewhere near
 * it. A jump that lands somewhere the user did not ask for is worse than no
 * jump at all.
 */
export function stripStartFor(
  current: YearMonth,
  target: YearMonth,
  stripMonths: number,
): YearMonth {
  const offset = monthsBetween(current, target)
  const last = stripMonths - GRID_MONTHS
  if (offset < 0) return target
  if (offset > last) return addMonths(target, -last)
  return current
}

/**
 * What one half-day cell is, in the order the vocabulary resolves.
 *
 * Order matters: an absence on a weekend still reads as an absence, because it
 * is a real entry someone made and hiding it would make it uneditable. "Off the
 * team" wins over everything, because those days are not the member's to be
 * absent from (§7.4).
 */
export type CellState = 'off-team' | 'absence' | 'recurring' | 'non-working' | 'weekend' | 'free'

export const ABSENT_STATES: readonly CellState[] = ['absence', 'recurring']

/** True when this half-day carries an absence of either kind. */
export const isAbsent = (state: CellState) => state === 'absence' || state === 'recurring'

/** Which absence covers each `member|date|half`, keyed for O(1) lookup. */
export type Coverage = ReadonlyMap<string, Absence>

export const cellKey = (memberId: string, date: string, half: Half) =>
  `${memberId}|${date}|${half}`

/**
 * Index every occurrence the server expanded, so the grid is a map lookup.
 *
 * Later entries win a collision, which only decides *which* absence a click
 * selects — the capacity maths unions them and charges the half-day once
 * either way (§3.4).
 */
export function buildCoverage(absences: readonly Absence[]): Coverage {
  const map = new Map<string, Absence>()
  for (const absence of absences) {
    for (const occurrence of absence.occurrences ?? []) {
      for (const half of occurrence.halves) {
        map.set(cellKey(absence.member_id, occurrence.date, half), absence)
      }
    }
  }
  return map
}

/** True when the member's contract owes this half-day, per the version on screen. */
export function worksHalf(member: TeamMember, date: string, half: Half): boolean {
  const version = member.effective_version
  if (!version) return false
  return Boolean(version[`${weekdayOf(date)}_${half}` as HalfDayKey])
}

export function onTeam(member: TeamMember, date: string): boolean {
  if (member.active_from && date < member.active_from) return false
  return !(member.active_to && date > member.active_to)
}

export function cellStateFor(
  member: TeamMember,
  date: string,
  half: Half,
  coverage: Coverage,
): CellState {
  if (!onTeam(member, date)) return 'off-team'
  const absence = coverage.get(cellKey(member.system_id, date, half))
  if (absence) return absence.kind === 'range' ? 'absence' : 'recurring'
  if (!worksHalf(member, date, half)) {
    return isWeekendDay(date) ? 'weekend' : 'non-working'
  }
  return 'free'
}

/**
 * How many **half-days** each month of the minimap holds — its density bars (§7.4).
 *
 * Half-days rather than entries, so a fortnight of leave outweighs a single
 * afternoon: the bar is meant to say where the weight is, and one tall entry and
 * twelve short ones are not the same month to plan around.
 */
export function monthDensity(
  absences: readonly Absence[],
  months: readonly YearMonth[],
): number[] {
  const counts = months.map(() => 0)
  const index = new Map(months.map((m, i) => [`${m.year}-${pad(m.month)}`, i]))
  for (const absence of absences) {
    for (const occurrence of absence.occurrences ?? []) {
      const slot = index.get(occurrence.date.slice(0, 7))
      if (slot !== undefined) counts[slot] += occurrence.halves.length
    }
  }
  return counts
}

/** Every `(date, half)` a rectangular drag covers, in reading order. */
export function halvesInRange(from: string, to: string): { date: string; half: Half }[] {
  const [start, end] = from <= to ? [from, to] : [to, from]
  return daysBetween(start, end).flatMap((date) => HALVES.map((half) => ({ date, half })))
}

/** A sentence for the selected-entry bar: "20–31 Jul 2026 · both halves · 10 d". */
export function occurrenceSummary(absence: Absence): string {
  const occurrences = absence.occurrences ?? []
  if (occurrences.length === 0) return 'no occurrences in view'
  const halfDays = occurrences.reduce((total, o) => total + o.halves.length, 0)
  const days = halfDays / 2
  const count = `${days % 1 === 0 ? days : days.toFixed(1)} d`
  return occurrences.length === 1
    ? `${occurrences[0].date} · ${count}`
    : `${occurrences[0].date} – ${occurrences[occurrences.length - 1].date} · ${occurrences.length} occurrences · ${count}`
}

/**
 * The next few dates a recurrence would hit — the dialog's check against an
 * off-by-one week (§3.4).
 *
 * A deliberate, small duplication of the server's anchoring rule: the chips have
 * to be drawn *before* the row exists, so there is nothing to ask. Only the
 * shown dates come from here — every occurrence the grid draws and every
 * half-day capacity deducts is expanded by the backend, which stays the one
 * authority once the rule is saved.
 */
export function previewOccurrences(
  anchor: string,
  weekday: number,
  intervalWeeks: number,
  count: number,
  until?: string | null,
): string[] {
  if (!anchor || Number.isNaN(weekday)) return []
  const offset = (weekday - weekdayIndex(anchor) + 7) % 7
  const out: string[] = []
  for (let index = 0; index < count; index += 1) {
    const day = shiftDays(anchor, offset + index * intervalWeeks * 7)
    if (until && day > until) break
    out.push(day)
  }
  return out
}

/** One half-day cell, as the drag gesture addresses it. */
export interface GridCell {
  readonly memberIndex: number
  readonly date: string
  readonly half: Half
}

/** The rectangle a drag covers: rows of members × a span of half-days. */
export interface DragRange {
  readonly memberFrom: number
  readonly memberTo: number
  readonly from: string
  readonly to: string
  readonly startHalf: Half
  readonly endHalf: Half
}

/**
 * The rectangle between two cells, however the drag went.
 *
 * Rectangular rather than reading-order, because the gesture's meaning is "these
 * people, those days" — a text-selection shape would make dragging down and left
 * cover a ragged set nobody asked for. Normalised in both axes so a drag
 * upwards or backwards produces the same range as the reverse.
 *
 * The result maps exactly onto a `range` absence per member, which is why the
 * drop can pre-fill the dialog rather than inventing a shape of its own.
 */
export function dragRange(anchor: GridCell, head: GridCell): DragRange {
  const [first, last] =
    anchor.date < head.date || (anchor.date === head.date && anchor.half === 'am')
      ? [anchor, head]
      : [head, anchor]
  return {
    memberFrom: Math.min(anchor.memberIndex, head.memberIndex),
    memberTo: Math.max(anchor.memberIndex, head.memberIndex),
    from: first.date,
    to: last.date,
    startHalf: first.half,
    endHalf: last.half,
  }
}

export function inDragRange(range: DragRange, memberIndex: number, date: string, half: Half): boolean {
  if (memberIndex < range.memberFrom || memberIndex > range.memberTo) return false
  if (date < range.from || date > range.to) return false
  if (date === range.from && range.startHalf === 'pm' && half === 'am') return false
  if (date === range.to && range.endHalf === 'am' && half === 'pm') return false
  return true
}

/**
 * How many half-days a drag would actually remove.
 *
 * Cells the member does not work, or is not yet on the team for, are **clipped
 * rather than blocking**: the drag stays valid and simply does not count them.
 * Blocking would make a team-wide holiday impossible to draw across a
 * part-timer's Friday (§3.4).
 */
export function countHalfDaysIn(
  range: DragRange,
  members: readonly TeamMember[],
  days: readonly string[],
): number {
  let total = 0
  for (let index = range.memberFrom; index <= range.memberTo; index += 1) {
    const member = members[index]
    if (!member) continue
    for (const date of days) {
      for (const half of HALVES) {
        if (!inDragRange(range, index, date, half)) continue
        if (onTeam(member, date) && worksHalf(member, date, half)) total += 1
      }
    }
  }
  return total
}
