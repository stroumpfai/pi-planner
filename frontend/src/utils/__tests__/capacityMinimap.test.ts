import {
  bestSprintIndex,
  frameMonthFor,
  lostPersonDays,
  monthlyLostCapacity,
  sprintOffsetFor,
  windowHoldsMonth,
} from '../capacityMinimap'
import { monthsFrom } from '../timelineMonths'
import type { CapacityBreakdown, CapacitySprint } from '@/types'

const sprint = (over: Partial<CapacitySprint> = {}): CapacitySprint => ({
  sprint_id: 's-1',
  pi_id: 'pi-1',
  pi_name: 'Q2-2026',
  pi_state: 'draft',
  sprint_number: 1,
  label: 'Q2-2026.1',
  start_date: '2026-04-06',
  end_date: '2026-04-17',
  computable: true,
  available: 12,
  ...over,
})

/** Contracted 80 h, 8 h of it lost to absences and meetings — 1 PD at an 8 h day. */
const breakdown = (over: Partial<CapacityBreakdown> = {}): CapacityBreakdown => ({
  contracted_half_days: 20,
  contracted_hours: 80,
  absent_half_days: 1,
  hours_after_absences: 76,
  meeting_hours: 4,
  hours_after_meetings: 72,
  net_hours: 72,
  person_days: 9,
  present_days: 9.5,
  ...over,
})

describe('lostPersonDays', () => {
  it('counts the absence and meeting steps, and nothing after them', () => {
    // Focus is a standing property of the team, not something that happened in
    // a month, so a 0.8 focus must not raise the bar (§5.4).
    expect(lostPersonDays(breakdown({ net_hours: 57.6 }), 8)).toBe(1)
  })

  it('is zero for a sprint with no figures, and for a nonsense day length', () => {
    expect(lostPersonDays(null, 8)).toBe(0)
    expect(lostPersonDays(breakdown(), 0)).toBe(0)
  })
})

describe('monthlyLostCapacity', () => {
  it('splits a sprint that straddles a month end across both months', () => {
    // 27 Apr – 8 May is 12 days: 4 in April, 8 in May. Twelve person-days lost
    // therefore land 4 / 8, not 12 / 0 on whichever month it starts in.
    const sprints = [sprint({ start_date: '2026-04-27', end_date: '2026-05-08' })]
    const team = [breakdown({ contracted_hours: 96, hours_after_meetings: 0 })]

    const [april, may] = monthlyLostCapacity(sprints, team, 8, monthsFrom({ year: 2026, month: 4 }, 2))

    expect(april).toBeCloseTo(4)
    expect(may).toBeCloseTo(8)
  })

  it('sums the sprints sharing a month and leaves the rest at zero', () => {
    const sprints = [
      sprint({ start_date: '2026-04-06', end_date: '2026-04-17' }),
      sprint({ sprint_id: 's-2', start_date: '2026-04-20', end_date: '2026-05-01' }),
    ]
    const team = [breakdown(), breakdown()]

    const months = monthsFrom({ year: 2026, month: 3 }, 4)
    const [march, april, may, june] = monthlyLostCapacity(sprints, team, 8, months)

    expect(march).toBe(0)
    expect(june).toBe(0)
    // s-2 is 12 days, 11 of them in April and 1 May Day.
    expect(april).toBeCloseTo(1 + 11 / 12)
    expect(may).toBeCloseTo(1 / 12)
  })

  it('ignores a sprint with no dates and one with no figures', () => {
    const sprints = [
      sprint({ start_date: null, end_date: null }),
      sprint({ sprint_id: 's-2', start_date: '2026-04-06', end_date: '2026-04-17' }),
    ]

    const months = monthsFrom({ year: 2026, month: 4 }, 1)
    expect(monthlyLostCapacity(sprints, [breakdown(), null], 8, months)).toEqual([0])
  })
})

describe('bestSprintIndex', () => {
  const calendar = [
    sprint({ sprint_id: 's-1', start_date: '2026-04-06', end_date: '2026-04-17' }),
    sprint({ sprint_id: 's-2', start_date: '2026-04-20', end_date: '2026-05-01' }),
    sprint({ sprint_id: 's-3', start_date: '2026-08-03', end_date: '2026-08-14' }),
  ]

  it('takes the earliest sprint overlapping the month', () => {
    expect(bestSprintIndex(calendar, { year: 2026, month: 4 })).toBe(0)
    expect(bestSprintIndex(calendar, { year: 2026, month: 5 })).toBe(1)
  })

  it('falls back to the nearest sprint when the month holds none', () => {
    // June is 5 weeks past s-2's end and 9 before s-3's start.
    expect(bestSprintIndex(calendar, { year: 2026, month: 6 })).toBe(1)
    expect(bestSprintIndex(calendar, { year: 2026, month: 7 })).toBe(2)
    expect(bestSprintIndex(calendar, { year: 2025, month: 1 })).toBe(0)
    expect(bestSprintIndex(calendar, { year: 2030, month: 1 })).toBe(2)
  })

  it('answers -1 when no sprint has dates, rather than inventing a position', () => {
    expect(bestSprintIndex([sprint({ start_date: null, end_date: null })], { year: 2026, month: 4 }))
      .toBe(-1)
    expect(bestSprintIndex([], { year: 2026, month: 4 })).toBe(-1)
  })
})

describe('sprintOffsetFor', () => {
  it('puts the chosen sprint first, and backs up at the end of the calendar', () => {
    expect(sprintOffsetFor(3, 20, 6)).toBe(3)
    expect(sprintOffsetFor(18, 20, 6)).toBe(14)
    expect(sprintOffsetFor(2, 4, 6)).toBe(0)
  })
})

describe('frameMonthFor', () => {
  const calendar = [
    sprint({ sprint_id: 's-1', start_date: null, end_date: null }),
    sprint({ sprint_id: 's-2', start_date: '2026-04-06', end_date: '2026-04-17' }),
  ]

  it('skips an undated sprint to the first one the calendar can place', () => {
    expect(frameMonthFor(calendar, 0, { year: 2000, month: 1 })).toEqual({ year: 2026, month: 4 })
  })

  it('falls back to the given month when nothing is dated at all', () => {
    expect(frameMonthFor([calendar[0]], 0, { year: 2026, month: 9 })).toEqual({
      year: 2026,
      month: 9,
    })
  })
})

describe('windowHoldsMonth', () => {
  const windowed = [
    sprint({ sprint_id: 's-1', start_date: '2026-06-29', end_date: '2026-07-10' }),
    sprint({ sprint_id: 's-2', start_date: '2026-07-13', end_date: '2026-07-24' }),
  ]

  it('holds every month the sprints on screen touch', () => {
    // Including June, which the first sprint only reaches by two days — the
    // frame may sit on either, and which one is the reader's to say.
    expect(windowHoldsMonth(windowed, { year: 2026, month: 6 })).toBe(true)
    expect(windowHoldsMonth(windowed, { year: 2026, month: 7 })).toBe(true)
  })

  it('does not hold a month the table has clamped away from', () => {
    expect(windowHoldsMonth(windowed, { year: 2026, month: 8 })).toBe(false)
    expect(windowHoldsMonth(windowed, { year: 2027, month: 2 })).toBe(false)
    expect(windowHoldsMonth([sprint({ start_date: null, end_date: null })], { year: 2026, month: 7 }))
      .toBe(false)
  })
})
