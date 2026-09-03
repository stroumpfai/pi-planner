import {
  DEFAULT_STRIP_MONTHS,
  MIN_MONTH_COLUMN,
  addMonths,
  buildCoverage,
  cellStateFor,
  countHalfDaysIn,
  daysBetween,
  dragRange,
  inDragRange,
  lastDay,
  monthDensity,
  monthOf,
  monthsBetween,
  monthsFrom,
  previewOccurrences,
  shiftDays,
  stripMonthsFor,
  isWeekStart,
  stripStartFor,
  weekdayIndex,
  windowOf,
} from '../absenceGrid'
import type { Absence, TeamMember } from '@/types'

const absence = (over: Partial<Absence> = {}): Absence =>
  ({
    system_id: 'ab-1',
    team_id: 't-1',
    member_id: 'm-1',
    label: null,
    kind: 'range',
    start_date: '2026-09-14',
    end_date: null,
    start_half: 'am',
    end_half: 'pm',
    weekday: null,
    halves: null,
    interval_weeks: null,
    summary: '',
    occurrences: [{ date: '2026-09-14', halves: ['am', 'pm'] }],
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"tag"',
    ...over,
  }) as Absence

const member = (over: Partial<TeamMember> = {}): TeamMember =>
  ({
    system_id: 'm-1',
    team_id: 't-1',
    name: 'Marta',
    role: null,
    organisation: null,
    active_from: null,
    active_to: null,
    order_index: 0,
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"m"',
    version_dates: [],
    absence_count: 0,
    meeting_count: 0,
    effective_version: {
      system_id: 'v-1',
      member_id: 'm-1',
      effective_from: '2026-01-01',
      mon_am: true, mon_pm: true,
      tue_am: true, tue_pm: true,
      wed_am: true, wed_pm: true,
      thu_am: true, thu_pm: true,
      fri_am: true, fri_pm: true,
      sat_am: false, sat_pm: false,
      sun_am: false, sun_pm: false,
      hours_per_day: 8,
      focus: 1,
      note: null,
      created_at: '2026-01-01T00:00:00Z',
      modified_at: '2026-01-01T00:00:00Z',
      etag: '"v"',
    },
    ...over,
  }) as TeamMember

describe('date arithmetic', () => {
  it('crosses a month boundary without a Date object in sight', () => {
    expect(shiftDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('handles a leap day', () => {
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(lastDay({ year: 2028, month: 2 })).toBe('2028-02-29')
  })

  it('numbers weekdays from Monday, as the API does', () => {
    expect(weekdayIndex('2026-09-14')).toBe(0)
    expect(weekdayIndex('2026-09-20')).toBe(6)
  })

  it('wraps the year when adding months', () => {
    expect(addMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 })
    expect(addMonths({ year: 2026, month: 2 }, -3)).toEqual({ year: 2025, month: 11 })
  })

  it('spans six months inclusively — the calendar\'s own width', () => {
    expect(windowOf({ year: 2026, month: 9 }, 6)).toEqual({
      from: '2026-09-01',
      to: '2027-02-28',
    })
  })

  it('counts whole months in both directions', () => {
    expect(monthsBetween({ year: 2026, month: 9 }, { year: 2027, month: 2 })).toBe(5)
    expect(monthsBetween({ year: 2027, month: 2 }, { year: 2026, month: 9 })).toBe(-5)
  })

  it('finds the Monday a week is ruled at', () => {
    // 14 September 2026 is a Monday, the 13th a Sunday.
    expect(isWeekStart('2026-09-14')).toBe(true)
    expect(isWeekStart('2026-09-13')).toBe(false)
    // Every seventh day and no other, across a month boundary.
    const mondays = daysBetween('2026-09-01', '2026-10-31').filter(isWeekStart)
    expect(mondays).toHaveLength(8)
    expect(mondays[0]).toBe('2026-09-07')
  })

  it('lists days inclusively', () => {
    expect(daysBetween('2026-09-14', '2026-09-16')).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16',
    ])
  })
})

describe('cell vocabulary', () => {
  const coverage = buildCoverage([absence()])

  it('reads a covered half-day as an absence', () => {
    expect(cellStateFor(member(), '2026-09-14', 'am', coverage)).toBe('absence')
  })

  it('distinguishes a recurring occurrence, because it deletes as a series', () => {
    const recurring = buildCoverage([
      absence({ kind: 'interval', occurrences: [{ date: '2026-09-14', halves: ['am'] }] }),
    ])
    expect(cellStateFor(member(), '2026-09-14', 'am', recurring)).toBe('recurring')
  })

  it('marks a weekend apart from an ordinary unworked half-day', () => {
    expect(cellStateFor(member(), '2026-09-19', 'am', new Map())).toBe('weekend')
    const partTimer = member({
      effective_version: { ...member().effective_version!, fri_pm: false },
    })
    expect(cellStateFor(partTimer, '2026-09-18', 'pm', new Map())).toBe('non-working')
  })

  it('shows days before someone joins as not theirs to be absent from', () => {
    const joiner = member({ active_from: '2026-10-01' })
    expect(cellStateFor(joiner, '2026-09-14', 'am', coverage)).toBe('off-team')
  })

  it('still shows an absence entered on a weekend, so it stays editable', () => {
    const weekendEntry = buildCoverage([
      absence({ occurrences: [{ date: '2026-09-19', halves: ['am'] }] }),
    ])
    expect(cellStateFor(member(), '2026-09-19', 'am', weekendEntry)).toBe('absence')
  })
})

describe('the drag rectangle', () => {
  const anchor = { memberIndex: 1, date: '2026-09-15', half: 'pm' as const }

  it('normalises a drag made backwards and upwards', () => {
    const head = { memberIndex: 0, date: '2026-09-14', half: 'am' as const }
    expect(dragRange(anchor, head)).toEqual({
      memberFrom: 0,
      memberTo: 1,
      from: '2026-09-14',
      to: '2026-09-15',
      startHalf: 'am',
      endHalf: 'pm',
    })
  })

  it('keeps a single half-day a single half-day', () => {
    expect(dragRange(anchor, anchor)).toEqual({
      memberFrom: 1,
      memberTo: 1,
      from: '2026-09-15',
      to: '2026-09-15',
      startHalf: 'pm',
      endHalf: 'pm',
    })
  })

  it('excludes the morning of a range that opens at noon', () => {
    const range = dragRange(anchor, { memberIndex: 1, date: '2026-09-16', half: 'am' })
    expect(inDragRange(range, 1, '2026-09-15', 'am')).toBe(false)
    expect(inDragRange(range, 1, '2026-09-15', 'pm')).toBe(true)
    expect(inDragRange(range, 1, '2026-09-16', 'pm')).toBe(false)
  })

  it('counts only half-days the member actually works — invalid cells clip', () => {
    const partTimer = member({
      system_id: 'm-2',
      effective_version: { ...member().effective_version!, fri_am: false, fri_pm: false },
    })
    const days = daysBetween('2026-09-14', '2026-09-18')
    const range = dragRange(
      { memberIndex: 0, date: '2026-09-14', half: 'am' },
      { memberIndex: 1, date: '2026-09-18', half: 'pm' },
    )
    // Ten half-days each, less the part-timer's Friday.
    expect(countHalfDaysIn(range, [member(), partTimer], days)).toBe(18)
  })

  it('skips days before a member joins rather than refusing the drag', () => {
    const joiner = member({ system_id: 'm-3', active_from: '2026-09-16' })
    const days = daysBetween('2026-09-14', '2026-09-16')
    const range = dragRange(
      { memberIndex: 0, date: '2026-09-14', half: 'am' },
      { memberIndex: 0, date: '2026-09-16', half: 'pm' },
    )
    expect(countHalfDaysIn(range, [joiner], days)).toBe(2)
  })
})

describe('the minimap', () => {
  it('counts half-days per month, so an empty stretch reads as empty', () => {
    const months = monthsFrom({ year: 2026, month: 9 }, 4)
    const rows = [
      absence({ occurrences: [{ date: '2026-09-14', halves: ['am', 'pm'] }] }),
      absence({ system_id: 'ab-2', occurrences: [{ date: '2026-12-25', halves: ['am', 'pm'] }] }),
    ]
    expect(monthDensity(rows, months)).toEqual([2, 0, 0, 2])
  })

  it('ignores occurrences outside the strip', () => {
    const months = monthsFrom({ year: 2026, month: 9 }, 2)
    const rows = [absence({ occurrences: [{ date: '2027-01-05', halves: ['am'] }] })]
    expect(monthDensity(rows, months)).toEqual([0, 0])
  })
})

describe('how many months of density a track can carry', () => {
  it('falls back to a year before anything has been measured', () => {
    // The first render, and every render in a test environment with no layout.
    expect(stripMonthsFor(0)).toBe(DEFAULT_STRIP_MONTHS)
    expect(stripMonthsFor(Number.NaN)).toBe(DEFAULT_STRIP_MONTHS)
    expect(stripMonthsFor(-500)).toBe(DEFAULT_STRIP_MONTHS)
  })

  it('never drops below one year, however narrow the track', () => {
    expect(stripMonthsFor(200)).toBe(12)
    expect(stripMonthsFor(MIN_MONTH_COLUMN * 11)).toBe(12)
  })

  it('spans whole years only, so a year marker never covers a part of one', () => {
    // 19 columns fit at 1240px, and 19 months would end in a 7-month "year".
    expect(stripMonthsFor(1240)).toBe(12)
    expect(stripMonthsFor(1800)).toBe(24)
    expect(stripMonthsFor(2480)).toBe(36)
  })

  it('snaps exactly on the width a further year needs', () => {
    expect(stripMonthsFor(MIN_MONTH_COLUMN * 24 - 1)).toBe(12)
    expect(stripMonthsFor(MIN_MONTH_COLUMN * 24)).toBe(24)
    expect(stripMonthsFor(MIN_MONTH_COLUMN * 36)).toBe(36)
  })

  it('stops at three years — more density than anyone reads at once', () => {
    expect(stripMonthsFor(10_000)).toBe(36)
  })

  it('squeezes the columns rather than showing less than a year', () => {
    // Below 12 × 64px the two rules collide, and the year wins: the strip is the
    // navigation control and the window the absences are fetched over, so it
    // always spans a year even when that means narrow columns.
    expect(stripMonthsFor(640)).toBe(12)
    expect(640 / stripMonthsFor(640)).toBeLessThan(MIN_MONTH_COLUMN)
  })

  it('holds the column floor everywhere it can — past one year, always', () => {
    for (const width of [1024, 1240, 1440, 1800, 2480, 3440]) {
      const months = stripMonthsFor(width)
      if (months > 12) expect(width / months).toBeGreaterThanOrEqual(MIN_MONTH_COLUMN)
    }
  })
})

describe('anchoring the minimap on a chosen month', () => {
  const strip = { year: 2026, month: 9 }

  it('leaves the strip alone when the frame already fits inside it', () => {
    // Six-month frame in a twelve-month strip: Dec is offset 3, well inside.
    expect(stripStartFor(strip, { year: 2026, month: 12 }, 12)).toEqual(strip)
  })

  it('slides the strip the least it can when the month is past its end', () => {
    // Sep 2027 is offset 12; the frame's last legal start is offset 6.
    expect(stripStartFor(strip, { year: 2027, month: 9 }, 12)).toEqual({ year: 2027, month: 3 })
  })

  it('re-anchors on a month before the strip begins', () => {
    expect(stripStartFor(strip, { year: 2026, month: 2 }, 12)).toEqual({ year: 2026, month: 2 })
  })

  it('reaches further before sliding once the strip spans three years', () => {
    // Offset 12 is well inside a 36-month strip, so it does not move at all.
    expect(stripStartFor(strip, { year: 2027, month: 9 }, 36)).toEqual(strip)
    // Offset 31 is past the last legal frame start (30), so it slides by one.
    expect(stripStartFor(strip, { year: 2029, month: 4 }, 36)).toEqual({ year: 2026, month: 10 })
  })

  it('always leaves the chosen month first in the calendar', () => {
    // The property the old clamp broke: a click landed near the month, not on it.
    for (const stripMonths of [12, 24, 36]) {
      for (const target of monthsFrom({ year: 2025, month: 1 }, 72)) {
        const anchored = stripStartFor(strip, target, stripMonths)
        const offset = monthsBetween(anchored, target)
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThanOrEqual(stripMonths - 6)
      }
    }
  })
})

describe('the interval preview', () => {
  it('anchors on the first matching weekday on or after the date', () => {
    // 1 September 2026 is a Tuesday; the first Friday after it is the 4th.
    expect(previewOccurrences('2026-09-01', 4, 2, 3)).toEqual([
      '2026-09-04', '2026-09-18', '2026-10-02',
    ])
  })

  it('crosses the year boundary without a parity seam', () => {
    expect(previewOccurrences('2026-12-18', 4, 2, 3)).toEqual([
      '2026-12-18', '2027-01-01', '2027-01-15',
    ])
  })

  it('stops at an end date', () => {
    expect(previewOccurrences('2026-09-04', 4, 2, 5, '2026-09-30')).toEqual([
      '2026-09-04', '2026-09-18',
    ])
  })
})

describe('monthOf', () => {
  it('reads a month out of an ISO date without timezone drift', () => {
    expect(monthOf('2026-01-01')).toEqual({ year: 2026, month: 1 })
    expect(monthOf('2026-12-31')).toEqual({ year: 2026, month: 12 })
  })
})
