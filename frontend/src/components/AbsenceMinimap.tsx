import { useMemo } from 'react'
import { TimelineMinimap } from '@/components/TimelineMinimap'
import type { Absence } from '@/types'
import { GRID_MONTHS, monthDensity, monthsFrom, type YearMonth } from '@/utils/absenceGrid'

interface Props {
  /** The first of the twelve months the strip covers. */
  readonly windowStart: YearMonth
  /** The first of the six months the grid below is showing. */
  readonly gridStart: YearMonth
  readonly absences: readonly Absence[]
  readonly onGridStart: (month: YearMonth) => void
  /** How many months the strip spans — measured below, owned by the caller. */
  readonly stripMonths: number
  readonly onStripMonths: (months: number) => void
  /** The month/year jump, rendered under the strip's own label (§7.4). */
  readonly children?: React.ReactNode
}

/**
 * The year above the absence grid (teams.md §7.4).
 *
 * All the strip's behaviour lives in {@link TimelineMinimap}; what is left here
 * is the one thing that is about *absences* — that a month's bar counts the
 * **half-days entered** in it, so a fortnight of leave outweighs a single
 * afternoon and the bar says where the weight is rather than how many rows
 * there are.
 */
export function AbsenceMinimap({
  windowStart,
  gridStart,
  absences,
  onGridStart,
  stripMonths,
  onStripMonths,
  children,
}: Props) {
  const density = useMemo(
    () => monthDensity(absences, monthsFrom(windowStart, stripMonths)),
    [absences, windowStart, stripMonths],
  )

  return (
    <TimelineMinimap
      windowStart={windowStart}
      frameStart={gridStart}
      frameMonths={GRID_MONTHS}
      density={density}
      describeDensity={(value) => (value ? `${value} half-days` : 'nothing entered')}
      onFrameStart={onGridStart}
      stripMonths={stripMonths}
      onStripMonths={onStripMonths}
    >
      {children}
    </TimelineMinimap>
  )
}
