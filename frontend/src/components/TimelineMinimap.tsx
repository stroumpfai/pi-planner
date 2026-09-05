import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useElementWidth } from '@/hooks/useElementWidth'
import {
  DEFAULT_FRAME_MONTHS,
  addMonths,
  monthLabel,
  monthsBetween,
  monthsFrom,
  stripMonthsFor,
  type YearMonth,
} from '@/utils/timelineMonths'

/**
 * How far a press must travel before it is a drag rather than a click.
 *
 * Four pixels: enough to absorb the movement in an ordinary mouse click, small
 * enough that a deliberate drag is never mistaken for a click on the month it
 * started over.
 */
const DRAG_THRESHOLD = 4

interface Props {
  /** The first month the strip covers. */
  readonly windowStart: YearMonth
  /** The first month the frame — the view below — is showing. */
  readonly frameStart: YearMonth
  /** How many months the frame spans. */
  readonly frameMonths?: number
  /**
   * One number per strip month, in the same order, on any scale the caller
   * likes: the bars are drawn relative to the largest of them, so what the
   * units are never reaches this component. Short arrays read as zero, which is
   * what a caller mid-resize has.
   */
  readonly density: readonly number[]
  /** What a bar's value means, spoken — "12 half-days", "3.5 PD lost". */
  readonly describeDensity: (value: number) => string
  readonly onFrameStart: (month: YearMonth) => void
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
  /** What the bars count, in the label column. Two short lines at most. */
  readonly hint?: ReactNode
  /** The month/year jump, rendered under this control's own label. */
  readonly children?: ReactNode
}

/**
 * A year above a table: density and navigation in one control (teams.md §7.4).
 *
 * Team data is entered years ahead — annual leave twelve months out is ordinary,
 * and a sprint calendar runs to the end of the next PI — so whatever the table
 * below shows is always a slice of something larger, and scrolling to reach
 * September 2028 is not a feature. The strip answers both halves of that: **bars
 * mark where the weight is**, so an empty stretch is visibly empty rather than
 * merely unvisited, and the **frame is the viewport** — drag it, or click a
 * month, and the table moves.
 *
 * Drawing the relationship rather than explaining it is the whole point: two
 * zoom levels stacked, with the frame showing which part of the top the bottom
 * is. A separate "next 6 months" pager would leave the reader to hold that
 * mapping in their head.
 *
 * **It knows nothing about what it is above.** Callers hand it a number per
 * month and a sentence for reading one aloud; absences count half-days entered
 * (§7.4) and capacity counts person-days lost to absences and meetings (§7.6),
 * and the strip draws both the same way. That is also why `onFrameStart` speaks
 * in months and not in rows: the capacity view answers it with the sprint that
 * best matches, which is a question only it can answer.
 */
export function TimelineMinimap({
  windowStart,
  frameStart,
  frameMonths = DEFAULT_FRAME_MONTHS,
  density,
  describeDensity,
  onFrameStart,
  stripMonths,
  onStripMonths,
  hint,
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
  const busiest = Math.max(1, ...density)

  const offset = monthsBetween(windowStart, frameStart)
  const [dragging, setDragging] = useState(false)

  // Where the press on the frame started, and whether it has become a drag.
  // A ref rather than state: the window listeners below read it on every move,
  // and a re-render per pixel to store a number nothing draws would be waste.
  const press = useRef<{ x: number; moved: boolean } | null>(null)

  const moveTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const bounds = track.getBoundingClientRect()
      const width = bounds.width / stripMonths
      // The pointer holds the frame's middle, which is what makes dragging feel
      // like moving a window rather than pushing its left edge.
      const centred = (clientX - bounds.left) / width - frameMonths / 2
      const clamped = Math.max(0, Math.min(stripMonths - frameMonths, Math.round(centred)))
      onFrameStart(addMonths(windowStart, clamped))
    },
    [onFrameStart, windowStart, stripMonths, frameMonths],
  )

  /** The month under an x, clicked as if its own bar had been. */
  const selectAt = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const bounds = track.getBoundingClientRect()
      if (bounds.width <= 0) return
      const index = Math.floor(((clientX - bounds.left) / bounds.width) * stripMonths)
      onFrameStart(addMonths(windowStart, Math.max(0, Math.min(stripMonths - 1, index))))
    },
    [onFrameStart, windowStart, stripMonths],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => {
      const started = press.current
      if (!started) return
      // Below the threshold nothing moves, so a click that wobbles a pixel is
      // still a click — and the frame no longer jitters under a still hand.
      if (!started.moved && Math.abs(event.clientX - started.x) < DRAG_THRESHOLD) return
      started.moved = true
      moveTo(event.clientX)
    }
    const onUp = () => {
      const started = press.current
      press.current = null
      setDragging(false)
      // A press that never moved is a click on whatever is under it. The frame
      // covers six of the strip's months, and without this those six are the
      // only ones a mouse cannot reach — the reader would have to drag the
      // frame off a month to be allowed to click it.
      if (started && !started.moved) selectAt(started.x)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, moveTo, selectAt])

  return (
    <div className="flex items-end gap-3 select-none">
      {/* Label column, the same 140px as the grid's names below — and the home
          of the date jump, which is the third way to move the same viewport. */}
      <div className="w-[140px] shrink-0 text-[11px] text-gray-400 dark:text-gray-500 leading-tight space-y-1.5">
        <div>
          {hint ?? (
            <>
              <p>Drag the frame</p>
              <p className="text-gray-500 dark:text-gray-400">or click a month</p>
            </>
          )}
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
          {months.map((month, index) => {
            const value = density[index] ?? 0
            return (
              <button
                key={`${month.year}-${month.month}`}
                type="button"
                // The clicked month leads the view. No clamp: the strip
                // re-anchors around it upstream, so a click never lands somewhere
                // the user did not name.
                onClick={() => onFrameStart(month)}
                aria-label={`Show ${monthLabel(month)} — ${describeDensity(value)}`}
                className={`flex-1 min-w-0 px-[3px] h-full flex items-end group ${
                  month.month === 1 && index > 0 ? 'border-l border-gray-400/50' : ''
                }`}
              >
                <span
                  className={`w-full rounded-sm ${
                    value > 0
                      ? 'bg-blue-400/70 group-hover:bg-blue-500'
                      : 'bg-band shadow-soft-inset group-hover:bg-blue-200/50'
                  }`}
                  style={{ height: `${value > 0 ? 20 + (value / busiest) * 60 : 12}%` }}
                />
              </button>
            )
          })}
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
          aria-label={`Showing ${monthLabel(frameStart)} to ${monthLabel(addMonths(frameStart, frameMonths - 1))} — drag to move, or click a month`}
          onPointerDown={(event) => {
            event.preventDefault()
            press.current = { x: event.clientX, moved: false }
            setDragging(true)
          }}
          // The same click-through, by the path that does not wait for an
          // effect: the window listeners are attached in one, and a click fast
          // enough to land before it runs — a synthetic one, or an impatient
          // hand — would otherwise fall through to nothing. Whichever of the
          // two arrives first clears the press, so the month moves once.
          onClick={(event) => {
            const started = press.current
            press.current = null
            if (started && !started.moved) selectAt(event.clientX)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && offset > 0) onFrameStart(addMonths(frameStart, -1))
            if (event.key === 'ArrowRight' && offset < stripMonths - frameMonths) {
              onFrameStart(addMonths(frameStart, 1))
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
            width: `${(frameMonths / stripMonths) * 100}%`,
          }}
        />
      </div>
    </div>
  )
}

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
