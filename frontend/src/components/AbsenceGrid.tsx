import { useCallback, useEffect, useRef, useState } from 'react'
import type { Absence, TeamMember } from '@/types'
import {
  MIN_DAY_WIDTH,
  buildCoverage,
  cellKey,
  cellStateFor,
  countHalfDaysIn,
  daysBetween,
  dragRange,
  inDragRange,
  isWeekStart,
  monthLabel,
  monthOf,
  type CellState,
  type DragRange,
  type GridCell,
} from '@/utils/absenceGrid'
import { HALVES, type Half } from '@/utils/workingDays'

interface Props {
  readonly members: readonly TeamMember[]
  readonly absences: readonly Absence[]
  readonly from: string
  readonly to: string
  readonly selectedId: string | null
  readonly canEdit: boolean
  readonly onSelect: (absence: Absence | null) => void
  /** A finished gesture. It **opens the dialog**; it never writes (§7.4). */
  readonly onDraft: (range: DragRange) => void
  /** The Delete key on a selected entry — the same action as the bin. */
  readonly onDeleteSelected: () => void
}

/** Pointer travel before a press becomes a drag, so a click stays a click. */
const ACTIVATION_DISTANCE = 4


/**
 * The line between morning and afternoon, drawn on the morning's underside.
 *
 * A *rule*, not a gap. A one-pixel gap would show the column's background
 * through it, and a free half-day is already the same colour as that background
 * — so the split the whole layout exists to show would be invisible on exactly
 * the cells people scan past most. Drawn over a filled absence too, which is
 * right: a whole day off is two half-days, and the column should say so.
 */
const HALF_RULE: Record<Half, string> = {
  am: 'border-b border-gray-400/40 dark:border-gray-500/40',
  pm: '',
}

/**
 * What each half-day is painted as — **flat fills, no soft shadows**.
 *
 * The app's neumorphic shadows are card shadows: a 6px blur at a 2px offset, an
 * 8px inset with 3px of spread. They need a box big enough to have a middle. A
 * cell is now 14px tall with its twin one pixel below it, and at that size the
 * inset's two halves meet and the drop shadow reaches across its neighbours —
 * washing out the very rule this layout depends on.
 *
 * So the ramp is carried by fill alone, which is size-independent: `free` is
 * lighter than the card, everything unavailable is darker than it, and the two
 * blues are unmistakably neither. `free` cannot stay `bg-canvas` — that is the
 * card's own colour, and the shadow was the only thing that had been making an
 * empty cell visible at all.
 */
const STATE_CLASS: Record<CellState, string> = {
  // Filled: an entered absence. Hatched: one occurrence of a recurring rule —
  // clicking either selects the whole entry, because there is no such thing as
  // one occurrence in this model (§3.4).
  absence: 'bg-blue-500',
  recurring: 'bg-blue-400 [background-image:repeating-linear-gradient(45deg,transparent,transparent_1px,rgba(255,255,255,.65)_1px,rgba(255,255,255,.65)_2px)]',
  'non-working': 'bg-band',
  weekend: 'bg-gray-300/70 dark:bg-gray-600/70',
  'off-team': 'bg-transparent [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(148,163,184,.5)_2px,rgba(148,163,184,.5)_3px)]',
  free: 'bg-white dark:bg-white/[0.08]',
}

/**
 * The half-day grid: members down, days across (teams.md §7.4; design 1b).
 *
 * **Drag across cells to create.** The gesture is the view's main input, and it
 * is written by hand rather than with dnd-kit: dnd-kit models dragging a *thing*
 * onto a *target*, and this is a rubber-band selection over a matrix — there is
 * no draggable and no droppable, only an anchor and a head. Everything the
 * design specifies for it is here: a 4px activation distance so a click stays a
 * click, a rectangular range over dates × member rows, a live count chip, and a
 * drop that **opens the dialog pre-filled and never writes silently**.
 *
 * **Invalid cells clip, they do not block.** Dragging a team-wide holiday across
 * a part-timer's unworked Friday must not stop at their row; the range simply
 * does not count that cell (§3.4).
 *
 * **A day is one column, morning above afternoon.** Stacking the halves is what
 * retires "half-day" as a marking of its own: a morning off is the top half of
 * the column filled, which needs no legend entry because it is not a code for
 * anything — it is the shape of the thing. Whole days read as solid columns and
 * a run of them as one bar, which is how a calendar draws leave.
 *
 * **The keyboard walks the grid the way it looks.** Left and right move a day at
 * a time in the same half; up and down step morning↔afternoon and on into the
 * next member's row, so the whole grid is one vertical sequence of half-days.
 * Space anchors, Shift+arrows extend, Enter opens the dialog, Delete removes the
 * selected entry. A roving tabindex keeps the grid one tab stop, not a thousand.
 */
export function AbsenceGrid({
  members,
  absences,
  from,
  to,
  selectedId,
  canEdit,
  onSelect,
  onDraft,
  onDeleteSelected,
}: Props) {
  const days = daysBetween(from, to)
  const coverage = buildCoverage(absences)

  const [focused, setFocused] = useState<GridCell | null>(null)
  const [anchor, setAnchor] = useState<GridCell | null>(null)
  const [head, setHead] = useState<GridCell | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<{ cell: GridCell; x: number; y: number; moved: boolean } | null>(null)

  const range = anchor && head ? dragRange(anchor, head) : null
  const dragging = Boolean(range && pressRef.current?.moved)

  const cellAt = (element: Element | null): GridCell | null => {
    const cell = element?.closest<HTMLElement>('[data-cell]')
    if (!cell) return null
    return {
      memberIndex: Number(cell.dataset.member),
      date: cell.dataset.date ?? '',
      half: (cell.dataset.half ?? 'am') as Half,
    }
  }

  const finish = useCallback(() => {
    const press = pressRef.current
    pressRef.current = null
    setPointer(null)
    if (!press) return
    if (press.moved && anchor && head) onDraft(dragRange(anchor, head))
    setAnchor(null)
    setHead(null)
  }, [anchor, head, onDraft])

  useEffect(() => {
    if (!pressRef.current) return
    const onMove = (event: PointerEvent) => {
      const press = pressRef.current
      if (!press) return
      if (!press.moved) {
        const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y)
        if (travelled < ACTIVATION_DISTANCE) return
        press.moved = true
      }
      setPointer({ x: event.clientX, y: event.clientY })
      const over = cellAt(document.elementFromPoint(event.clientX, event.clientY))
      if (over) setHead(over)
    }
    const onUp = () => finish()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [anchor, finish])

  const press = (event: React.PointerEvent) => {
    if (!canEdit) return
    const cell = cellAt(event.target as Element)
    if (!cell) return
    pressRef.current = { cell, x: event.clientX, y: event.clientY, moved: false }
    setAnchor(cell)
    setHead(cell)
    setFocused(cell)
  }

  const click = (event: React.MouseEvent) => {
    const cell = cellAt(event.target as Element)
    if (!cell) return
    setFocused(cell)
    const member = members[cell.memberIndex]
    onSelect(member ? (coverage.get(cellKey(member.system_id, cell.date, cell.half)) ?? null) : null)
  }

  /**
   * Move the focus by *dx* days and *dy* half-day rows.
   *
   * The two axes are the two the grid now draws: horizontal is time in whole
   * days, vertical is the stack of half-days — Marta's morning, Marta's
   * afternoon, Rui's morning — so ArrowDown off the bottom of one member lands
   * on the top of the next rather than skipping a half.
   */
  const move = (cell: GridCell, dx: number, dy: number, extend: boolean): void => {
    if (members.length === 0) return
    const dayIndex = Math.min(days.length - 1, Math.max(0, days.indexOf(cell.date) + dx))
    const rows = members.length * HALVES.length
    const row = Math.min(
      rows - 1,
      Math.max(0, cell.memberIndex * HALVES.length + HALVES.indexOf(cell.half) + dy),
    )
    const next: GridCell = {
      memberIndex: Math.floor(row / HALVES.length),
      date: days[dayIndex],
      half: HALVES[row % HALVES.length],
    }
    setFocused(next)
    if (extend) {
      setAnchor((current) => current ?? cell)
      setHead(next)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const cell = focused ?? { memberIndex: 0, date: days[0], half: 'am' as Half }
    const extend = event.shiftKey
    switch (event.key) {
      case 'ArrowRight': move(cell, 1, 0, extend); break
      case 'ArrowLeft': move(cell, -1, 0, extend); break
      case 'ArrowDown': move(cell, 0, 1, extend); break
      case 'ArrowUp': move(cell, 0, -1, extend); break
      case ' ':
        setAnchor(cell)
        setHead(cell)
        break
      case 'Enter':
        if (canEdit && anchor) onDraft(dragRange(anchor, head ?? cell))
        setAnchor(null)
        setHead(null)
        break
      case 'Delete':
      case 'Backspace':
        if (selectedId) onDeleteSelected()
        break
      default:
        return
    }
    event.preventDefault()
  }

  const counted = range ? countHalfDaysIn(range, members, days) : 0

  return (
    <div className="relative min-w-max">
      <MonthHeader days={days} />
      <div
        ref={gridRef}
        role="grid"
        aria-label="Absences by member and half-day"
        tabIndex={0}
        onPointerDown={press}
        onClick={click}
        onKeyDown={onKeyDown}
        className="touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
      >
        {members.map((member, memberIndex) => (
          <div key={member.system_id} role="row" className="flex items-center h-12 min-w-0">
            <div
              role="rowheader"
              className="w-[140px] shrink-0 pr-2 text-sm text-gray-700 dark:text-gray-200 truncate"
            >
              {member.name}
            </div>
            {/* The days divide whatever width is left over, down to a floor.
                No measurement: flex fills a wide screen and stops shrinking at
                MIN_DAY_WIDTH, which is where the wrapper starts scrolling. */}
            <div className="flex flex-1 min-w-0">
              {days.map((date) => (
                /* One column per day, morning above afternoon — the way a
                   calendar draws it, and the reason a half-day needs no
                   special mark: it is simply the half of the column it fills.

                   The left border is on **every** day and merely changes
                   colour on a Monday. A border Mondays alone carried would
                   make those columns a pixel wider than the rest, and by
                   February the month labels would sit over the wrong days. */
                <div
                  key={date}
                  className={`flex flex-col flex-1 min-w-0 border-l ${
                    isWeekStart(date)
                      ? 'border-gray-400/70 dark:border-gray-500/60'
                      : 'border-transparent'
                  }`}
                  style={{ minWidth: MIN_DAY_WIDTH }}
                  data-day={date}
                >
                  {HALVES.map((half) => {
                    const state = cellStateFor(member, date, half, coverage)
                    const selected =
                      selectedId !== null &&
                      coverage.get(cellKey(member.system_id, date, half))?.system_id === selectedId
                    const inRange = range ? inDragRange(range, memberIndex, date, half) : false
                    const isFocused =
                      focused?.memberIndex === memberIndex &&
                      focused.date === date &&
                      focused.half === half
                    return (
                      <span
                        key={half}
                        role="gridcell"
                        data-cell
                        data-member={memberIndex}
                        data-date={date}
                        data-half={half}
                        tabIndex={-1}
                        aria-selected={selected}
                        title={`${member.name} · ${date} ${half}`}
                        className={`h-[14px] ${HALF_RULE[half]} ${STATE_CLASS[state]} ${
                          inRange ? 'ring-1 ring-blue-500 bg-blue-300' : ''
                        } ${selected ? 'ring-1 ring-gray-900 dark:ring-white' : ''} ${
                          isFocused ? 'ring-1 ring-blue-400' : ''
                        }`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {dragging && pointer && (
        // The live count is what makes the gesture legible: a rectangle of 3px
        // cells says nothing about how much capacity it removes.
        <div
          className="fixed z-50 px-2 py-1 rounded-lg bg-gray-900 text-white text-xs shadow-soft pointer-events-none"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
        >
          {counted} half-day{counted === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}

interface MonthHeaderProps {
  readonly days: readonly string[]
}

/** Month names over the day columns, each as wide as the days it owns. */
function MonthHeader({ days }: MonthHeaderProps) {
  const spans: { key: string; label: string; count: number }[] = []
  for (const day of days) {
    const key = day.slice(0, 7)
    const last = spans[spans.length - 1]
    if (last && last.key === key) last.count += 1
    else spans.push({ key, label: monthLabel(monthOf(day)), count: 1 })
  }
  return (
    <header aria-label="Months shown" className="flex items-end pb-1">
      <div className="w-[140px] shrink-0" />
      {/* Weighted by day count and floored the same way as the day columns, so a
          month name sits over its own days at every width.

          The rule is a **border**, not an element: a border sits inside the
          label's own box, so the header keeps dividing the width by day count
          exactly as the rows do. A spacer element between labels would add three
          pixels the rows do not have, and by February the names would sit over
          the wrong days. */}
      <div className="flex flex-1 min-w-0 items-end">
        {spans.map((span) => (
          <div
            key={span.key}
            className="min-w-0 border-l-2 border-gray-400/80 dark:border-gray-500/80 pl-1 text-xs font-semibold text-gray-700 dark:text-gray-200"
            style={{ flex: `${span.count} 1 0%`, minWidth: span.count * MIN_DAY_WIDTH }}
          >
            <span className="whitespace-nowrap">{span.label}</span>
          </div>
        ))}
      </div>
    </header>
  )
}

/**
 * The cell vocabulary, spelled out — the grid is unreadable without it (§7.4).
 *
 * Four markings and a state that is not one. "Half-day" used to be a fifth line
 * of prose here, explaining that an absence could fill half a cell; stacking the
 * halves made the explanation unnecessary, so what remains is a note on how to
 * *read a column* rather than on how to decode one more pattern.
 */
export function AbsenceLegend() {
  const items: { state: CellState; label: string }[] = [
    { state: 'absence', label: 'absence' },
    { state: 'recurring', label: 'recurring' },
    { state: 'non-working', label: 'not working' },
    { state: 'weekend', label: 'weekend' },
    { state: 'off-team', label: 'not on the team yet' },
  ]
  return (
    <ul className="flex flex-wrap gap-4 text-[11px] text-gray-500 dark:text-gray-400">
      {items.map((item) => (
        <li key={item.state} className="flex items-center gap-1.5">
          {/* Shaped like the thing it names: one day's column, not a swatch. */}
          <span className={`w-2 h-[14px] ${STATE_CLASS[item.state]}`} />
          {item.label}
        </li>
      ))}
      <li className="text-gray-400 dark:text-gray-500">
        A column is one day — morning above, afternoon below.
      </li>
    </ul>
  )
}
