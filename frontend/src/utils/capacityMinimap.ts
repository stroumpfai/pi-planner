import type { CapacityBreakdown, CapacitySprint } from '@/types'
import {
  daysApart,
  daysBetween,
  firstDay,
  lastDay,
  pad,
  type YearMonth,
} from '@/utils/timelineMonths'

/** A sprint the strip can place in time. Undated sprints are not on any month. */
type DatedSprint = CapacitySprint & { start_date: string; end_date: string }

const dated = (sprint: CapacitySprint): sprint is DatedSprint =>
  Boolean(sprint.start_date && sprint.end_date)

/**
 * What absences and meetings took out of one sprint, in person-days.
 *
 * The §5.4 chain is contracted → absences → meetings → focus → ÷ normal day.
 * This is the middle of it: `contracted − after meetings`, which is exactly the
 * two deductions that are *events on a calendar*. Focus is deliberately left in
 * — it is a standing property of how a team works, not something that happened
 * in March, and folding it in would raise every bar by the same proportion
 * while telling the reader nothing about where to look.
 */
export function lostPersonDays(
  breakdown: CapacityBreakdown | null | undefined,
  normalDayHours: number,
): number {
  if (!breakdown || normalDayHours <= 0) return 0
  return Math.max(0, (breakdown.contracted_hours - breakdown.hours_after_meetings) / normalDayHours)
}

/**
 * Person-days lost per month — the capacity strip's bars (§7.6).
 *
 * Capacity is computed per **sprint** and the strip is drawn in **months**, so
 * each sprint's loss is spread evenly across the days it covers and summed into
 * the months those days fall in. A sprint straddling a month end therefore
 * lands on both, in proportion, instead of being charged whole to whichever
 * month it happens to start in — which is what makes two adjacent bars
 * comparable at all.
 *
 * Evenly across *calendar* days, not working ones: which days a member works is
 * a per-member contract this report has already folded into its totals, and
 * re-deriving it here to weight the spread would be a second, worse answer to a
 * question the bars only ask approximately. Sprints are whole weeks in practice,
 * so the two agree.
 */
export function monthlyLostCapacity(
  sprints: readonly CapacitySprint[],
  team: readonly (CapacityBreakdown | null)[],
  normalDayHours: number,
  months: readonly YearMonth[],
): number[] {
  const totals = months.map(() => 0)
  const slot = new Map(months.map((month, index) => [`${month.year}-${pad(month.month)}`, index]))

  sprints.forEach((sprint, index) => {
    if (!dated(sprint)) return
    const lost = lostPersonDays(team[index], normalDayHours)
    if (lost <= 0) return
    const days = daysBetween(sprint.start_date, sprint.end_date)
    if (days.length === 0) return
    const perDay = lost / days.length
    for (const day of days) {
      const at = slot.get(day.slice(0, 7))
      if (at !== undefined) totals[at] += perDay
    }
  })

  return totals
}

/**
 * The sprint a month names — the strip's whole contract with the table (§7.6).
 *
 * Months and sprints do not line up, and pretending otherwise is what would
 * make a click feel broken: a two-week sprint leaves months with two of them and
 * the gap between two PIs leaves months with none. So *best matching* is defined
 * here, in one place:
 *
 * 1. a sprint **overlapping** the month wins, the earliest of them if several —
 *    so clicking a month puts the table at the start of what that month holds;
 * 2. failing that, the **nearest** sprint by calendar distance, earlier one
 *    first on a tie, so a click in an empty stretch lands on the edge of the
 *    data it was reaching toward rather than nowhere.
 *
 * `-1` when no sprint has dates at all: there is nothing to match, and a caller
 * moving the table anyway would be inventing a position.
 */
export function bestSprintIndex(sprints: readonly CapacitySprint[], month: YearMonth): number {
  const from = firstDay(month)
  const to = lastDay(month)

  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY

  sprints.forEach((sprint, index) => {
    if (!dated(sprint)) return
    const distance =
      sprint.end_date < from
        ? daysApart(sprint.end_date, from)
        : sprint.start_date > to
          ? daysApart(to, sprint.start_date)
          : 0
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })

  return best
}

/**
 * Where the table's window has to start for *index* to be in it.
 *
 * The chosen sprint leads the window, except at the end of the calendar, where
 * there are not enough sprints left to fill one and the window backs up to the
 * last full page. Anything else would leave blank columns to the right of a
 * sprint the reader deliberately asked for.
 */
export function sprintOffsetFor(index: number, total: number, columns: number): number {
  return Math.max(0, Math.min(index, total - columns))
}

/**
 * Whether the sprints on screen reach into *month*.
 *
 * What the frame uses to decide whether it may sit on the month the reader
 * named: a sprint running 29 June – 10 July is the best match for July and the
 * best match for June, so anchoring the frame on its start date would answer a
 * click on July with a frame over June. Pinning the named month is only honest
 * while the table actually reaches it — click a month a year past the end of
 * the calendar and the window clamps to the last page, which the frame must
 * follow rather than hover over empty months.
 */
export function windowHoldsMonth(
  windowed: readonly CapacitySprint[],
  month: YearMonth,
): boolean {
  const placed = windowed.filter(dated)
  if (placed.length === 0) return false
  const from = placed.reduce((first, s) => (s.start_date < first ? s.start_date : first), placed[0].start_date)
  const to = placed.reduce((last, s) => (s.end_date > last ? s.end_date : last), placed[0].end_date)
  return firstDay(month) <= to && lastDay(month) >= from
}

/**
 * The month the frame sits on when nothing was named — given the table's window.
 *
 * The first *dated* sprint at or after the window's start, because an undated
 * sprint is nowhere on a calendar and drawing the frame at the fallback for one
 * would move it for a reason the reader cannot see. `fallback` — today's month —
 * is for a calendar with no dates in it at all.
 */
export function frameMonthFor(
  sprints: readonly CapacitySprint[],
  offset: number,
  fallback: YearMonth,
): YearMonth {
  const anchor = sprints.slice(offset).find(dated) ?? sprints.find(dated)
  if (!anchor) return fallback
  return { year: Number(anchor.start_date.slice(0, 4)), month: Number(anchor.start_date.slice(5, 7)) }
}
