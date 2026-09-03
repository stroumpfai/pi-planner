import { useCallback, useEffect, useRef, useState } from 'react'
import type { Absence } from '@/types'
import { useElementWidth } from '@/hooks/useElementWidth'
import {
  GRID_MONTHS,
  addMonths,
  monthDensity,
  monthLabel,
  monthsFrom,
  stripMonthsFor,
  type YearMonth,
} from '@/utils/absenceGrid'

interface Props {
  /** The first of the twelve months the strip covers. */
  readonly windowStart: YearMonth
  /** The first of the six months the grid below is showing. */
  readonly gridStart: YearMonth
  readonly absences: readonly Absence[]
  readonly onGridStart: (month: YearMonth) => void
  /** How many months the strip spans — measured here, owned by the caller. */
  readonly stripMonths: number
  /**
   * The strip's measured capacity, in whole years of months.
   *
   * Reported upward rather than kept here because the caller fetches the data
   * for those months: the span is a question about layout and an argument to a
   * query at the same time, and only one of the two can own it.
   */
  readonly onStripMonths: (months: number) => void
  /** The month/year jump, rendered under this control's own label (§7.4). */
  readonly children?: React.ReactNode
}

/**
 * The year above the grid: density and navigation in one control (teams.md §7.4).
 *
 * Absences are entered years ahead — annual leave is routinely planned twelve
 * months out — so the grid's four months are always a slice of something larger,
 * and scrolling to reach September 2028 is not a feature. The strip answers both
 * halves of that: **bars mark the months holding entries**, so an empty stretch
 * is visibly empty rather than merely unvisited, and the **frame is the
 * viewport** — drag it, or click a month, and the grid moves.
 *
 * Drawing the relationship rather than explaining it is the whole point: two
 * zoom levels stacked, with the frame showing which part of the top the bottom
 * is. A separate "next 4 months" pager would leave the reader to hold that
 * mapping in their head.
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
  const trackRef = useRef<HTMLDivElement | null>(null)
  const trackWidth = useElementWidth(trackRef)
  const fits = stripMonthsFor(trackWidth)

  // No feedback loop: the track is `flex-1`, so its width is fixed by the card
  // and not by how many columns end up inside it.
  useEffect(() => {
    if (fits !== stripMonths) onStripMonths(fits)
  }, [fits, stripMonths, onStripMonths])

  const months = monthsFrom(windowStart, stripMonths)
  const density = monthDensity(absences, months)
  const busiest = Math.max(1, ...density)

  const offset = monthOffset(windowStart, gridStart)
  const [dragging, setDragging] = useState(false)

  const moveTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const bounds = track.getBoundingClientRect()
      const width = bounds.width / stripMonths
      // The pointer holds the frame's middle, which is what makes dragging feel
      // like moving a window rather than pushing its left edge.
      const centred = (clientX - bounds.left) / width - GRID_MONTHS / 2
      const clamped = Math.max(0, Math.min(stripMonths - GRID_MONTHS, Math.round(centred)))
      onGridStart(addMonths(windowStart, clamped))
    },
    [onGridStart, windowStart, stripMonths],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => moveTo(event.clientX)
    const onUp = () => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, moveTo])

  return (
    <div className="flex items-end gap-3 select-none">
      {/* Label column, the same 140px as the grid's names below — and the home
          of the date jump, which is the third way to move the same viewport. */}
      <div className="w-[140px] shrink-0 text-[11px] text-gray-400 dark:text-gray-500 leading-tight space-y-1.5">
        <div>
          <p>Drag the frame</p>
          <p className="text-gray-500 dark:text-gray-400">or click a month</p>
        </div>
        {children}
      </div>

      {/* The track takes the whole width and the columns divide it, so the
          frame's percentage and the bars' widths are the same arithmetic.
          Capping either one is what previously let a six-month frame draw as
          wide as nine with its right half hanging over nothing — the months
          stopped at their cap while the frame kept using the full track. */}
      <div className="relative flex-1 min-w-0" ref={trackRef}>
        <div className="flex items-end h-7">
          {months.map((month, index) => (
            <button
              key={`${month.year}-${month.month}`}
              type="button"
              // The clicked month leads the calendar. No clamp: the strip
              // re-anchors around it upstream, so a click never lands somewhere
              // the user did not name.
              onClick={() => onGridStart(month)}
              aria-label={`Show ${monthLabel(month)}${density[index] ? ` — ${density[index]} half-days` : ' — nothing entered'}`}
              className={`flex-1 min-w-0 px-[3px] h-full flex items-end group ${
                month.month === 1 && index > 0 ? 'border-l border-gray-400/50' : ''
              }`}
            >
              <span
                className={`w-full rounded-sm ${
                  density[index] > 0
                    ? 'bg-blue-400/70 group-hover:bg-blue-500'
                    : 'bg-band shadow-soft-inset group-hover:bg-blue-200/50'
                }`}
                style={{ height: `${density[index] > 0 ? 20 + (density[index] / busiest) * 60 : 12}%` }}
              />
            </button>
          ))}
        </div>
        <div className="flex">
          {months.map((month) => (
            <div
              key={`${month.year}-${month.month}-label`}
              className="flex-1 min-w-0 text-center text-[11px] text-gray-500 dark:text-gray-400"
            >
              {monthLabel(month, false)}
            </div>
          ))}
        </div>

        {/* The strip is twelve months and starts wherever the reader last moved
            it, so it routinely straddles a year end. Without this, "Dec" and
            "Jan" sit side by side with nothing saying they are twelve months
            apart in one direction and one in the other. */}
        <div className="flex" aria-hidden="true">
          {yearSpans(months).map((span) => (
            <div
              key={span.year}
              style={{ flex: `${span.count} 1 0%` }}
              className="min-w-0 text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 border-t border-white/70 dark:border-white/10 pt-0.5"
            >
              {span.year}
            </div>
          ))}
        </div>

        {/* The frame is the viewport. It is a button so the keyboard path is the
            same one arrow keys already use elsewhere in the view. */}
        <button
          type="button"
          aria-label={`Showing ${monthLabel(gridStart)} to ${monthLabel(addMonths(gridStart, GRID_MONTHS - 1))} — drag to move`}
          onPointerDown={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && offset > 0) onGridStart(addMonths(gridStart, -1))
            if (event.key === 'ArrowRight' && offset < stripMonths - GRID_MONTHS) {
              onGridStart(addMonths(gridStart, 1))
            }
          }}
          // Stretched to the track rather than given a height: the frame has to
          // enclose everything the strip says about those months — the bars, the
          // month names *and* the year row — or the year a window sits in reads
          // as being outside it. Anchoring to both edges also means adding a row
          // to the strip cannot leave the frame half-covering it.
          className={`absolute -top-1 -bottom-1 rounded-lg border-[1.5px] border-blue-500 bg-blue-500/5 ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            left: `${(offset / stripMonths) * 100}%`,
            width: `${(GRID_MONTHS / stripMonths) * 100}%`,
          }}
        />
      </div>
    </div>
  )
}

const monthOffset = (from: YearMonth, to: YearMonth) =>
  (to.year - from.year) * 12 + (to.month - from.month)

/** The strip's months grouped into the years they belong to, in order. */
function yearSpans(months: readonly YearMonth[]): { year: number; count: number }[] {
  const spans: { year: number; count: number }[] = []
  for (const month of months) {
    const last = spans[spans.length - 1]
    if (last && last.year === month.year) last.count += 1
    else spans.push({ year: month.year, count: 1 })
  }
  return spans
}
