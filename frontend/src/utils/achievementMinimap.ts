import type { CapacitySprint } from '@/types'
import { daysBetween, pad, type YearMonth } from '@/utils/timelineMonths'

/**
 * Achieved person-days per month — the Achievement strip's bars (spec §5.2).
 *
 * The same spreading the capacity strip does for lost days: each sprint's
 * achieved PD is spread evenly over the calendar days it covers and summed into
 * the months those days fall in, so a sprint straddling a month end lands on
 * both in proportion. An undated sprint, or one whose figure is unknown (null),
 * is on no month and adds nothing — the bar under-reads rather than invents.
 */
export function monthlyAchievedPd(
  sprints: readonly CapacitySprint[],
  achievedPd: readonly (number | null)[],
  months: readonly YearMonth[],
): number[] {
  const totals = months.map(() => 0)
  const slot = new Map(months.map((month, index) => [`${month.year}-${pad(month.month)}`, index]))

  sprints.forEach((sprint, index) => {
    const value = achievedPd[index]
    if (!sprint.start_date || !sprint.end_date || value === null || value === undefined || value <= 0) return
    const days = daysBetween(sprint.start_date, sprint.end_date)
    if (days.length === 0) return
    const perDay = value / days.length
    for (const day of days) {
      const at = slot.get(day.slice(0, 7))
      if (at !== undefined) totals[at] += perDay
    }
  })

  return totals
}
