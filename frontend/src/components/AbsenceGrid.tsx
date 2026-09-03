import { useCallback, useEffect, useRef, useState } from 'react'
import type { Absence, TeamMember } from '@/types'
import {
  buildCoverage,
  cellKey,
  cellStateFor,
  countHalfDaysIn,
  daysBetween,
  dragRange,
  inDragRange,
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

const STATE_CLASS: Record<CellState, string> = {
  // Filled: an entered absence. Hatched: one occurrence of a recurring rule —
  // clicking either selects the whole entry, because there is no such thing as
  // one occurrence in this model (§3.4).
  absence: 'bg-blue-500',
  recurring: 'bg-blue-400 [background-image:repeating-linear-gradient(45deg,transparent,transparent_1px,rgba(255,255,255,.65)_1px,rgba(255,255,255,.65)_2px)]',
  'non-working': 'bg-band shadow-soft-inset',
  weekend: 'bg-gray-300/70 dark:bg-gray-600/70',
  'off-team': 'bg-transparent [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(148,163,184,.5)_2px,rgba(148,163,184,.5)_3px)]',
  free: 'bg-canvas shadow-soft-sm',
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
 * **Rows are 30px tall, not 15.** A half-day is 3px wide, so height is the only
 * dimension carrying the cell at all: at 15px a filled run read as a hairline
 * and the hatching that separates a recurrence from a one-off was invisible.
 *
 * **The keyboard path is complete**, not a courtesy: arrows move, Space anchors,
 * Shift+arrows extend, Enter opens the dialog, Delete removes the selected
 * entry. A roving tabindex keeps the grid one tab stop rather than a thousand.
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

  const move = (cell: GridCell, dx: number, dy: number, extend: boolean): void => {
    const halfIndex = HALVES.indexOf(cell.half) + dx
    const dayShift = Math.floor(halfIndex / 2)
    const dayIndex = Math.min(days.length - 1, Math.max(0, days.indexOf(cell.date) + dayShift))
    const next: GridCell = {
      memberIndex: Math.min(members.length - 1, Math.max(0, cell.memberIndex + dy)),
      date: days[dayIndex],
      half: HALVES[((halfIndex % 2) + 2) % 2],
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
    <div className="relative">
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
          <div key={member.system_id} role="row" className="flex items-center h-12">
            <div
              role="rowheader"
              className="w-[140px] shrink-0 pr-2 text-sm text-gray-700 dark:text-gray-200 truncate"
            >
              {member.name}
            </div>
            <div className="flex">
              {days.map((date) => (
                <div key={date} className="flex gap-px mr-px" data-day={date}>
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
                        className={`w-[3px] h-[30px] rounded-[1px] ${STATE_CLASS[state]} ${
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
      <div className="flex">
        {spans.map((span) => (
          <div
            key={span.key}
            className="text-xs font-semibold text-gray-500 dark:text-gray-400 border-l border-white/60 dark:border-white/10 pl-1"
            style={{ width: span.count * 8 }}
          >
            <span className="whitespace-nowrap">{span.label}</span>
          </div>
        ))}
      </div>
    </header>
  )
}

/** The cell vocabulary, spelled out — the grid is unreadable without it (§7.4). */
export function AbsenceLegend() {
  const items: { state: CellState; label: string }[] = [
    { state: 'absence', label: 'absence' },
    { state: 'recurring', label: 'recurring' },
    { state: 'non-working', label: 'not a working half-day' },
    { state: 'weekend', label: 'weekend' },
    { state: 'off-team', label: 'not on the team yet' },
  ]
  return (
    <ul className="flex flex-wrap gap-4 text-[11px] text-gray-500 dark:text-gray-400">
      {items.map((item) => (
        <li key={item.state} className="flex items-center gap-1.5">
          <span className={`w-3 h-[12px] rounded-[1px] ${STATE_CLASS[item.state]}`} />
          {item.label}
        </li>
      ))}
      <li className="text-gray-400 dark:text-gray-500">A half-day absence fills half a cell.</li>
    </ul>
  )
}
