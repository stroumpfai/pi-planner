import { describe, expect, it } from 'vitest'
import type { TeamHolidayEntry, TeamMember } from '@/types'
import {
  buildHolidayIndex,
  coverageSummary,
  holidaySpan,
  holidayStateFor,
  stripRows,
} from '@/utils/holidayGrid'

const entry = (over: Partial<TeamHolidayEntry> = {}): TeamHolidayEntry => ({
  system_id: 'h-1',
  calendar_id: 'c-1',
  calendar_name: 'National',
  label: 'Easter Monday',
  start_date: '2026-04-06',
  start_half: 'am',
  end_date: '2026-04-06',
  end_half: 'pm',
  days: [{ date: '2026-04-06', halves: ['am', 'pm'] }],
  exceptions: [],
  ...over,
})

const member = (id: string, name: string, over: Partial<TeamMember> = {}) =>
  ({ system_id: id, name, active_from: null, active_to: null, ...over }) as TeamMember

describe('holidayStateFor', () => {
  it('marks a covered half as holiday, and an uncovered one as nothing', () => {
    const index = buildHolidayIndex([entry()])
    expect(holidayStateFor('m-1', '2026-04-06', 'am', index)).toBe('holiday')
    expect(holidayStateFor('m-1', '2026-04-07', 'am', index)).toBeNull()
  })

  it('marks a member who works it as works-holiday', () => {
    const index = buildHolidayIndex([entry({ exceptions: [{ member_id: 'm-1', day: '2026-04-06' }] })])
    expect(holidayStateFor('m-1', '2026-04-06', 'pm', index)).toBe('works-holiday')
    expect(holidayStateFor('m-2', '2026-04-06', 'pm', index)).toBe('holiday')
  })

  it('keeps a member off when only one of two calendars on the day is worked', () => {
    const index = buildHolidayIndex([
      entry({ exceptions: [{ member_id: 'm-1', day: '2026-04-06' }] }),
      entry({ system_id: 'h-2', calendar_id: 'c-2', label: 'Office closed' }),
    ])
    expect(holidayStateFor('m-1', '2026-04-06', 'am', index)).toBe('holiday')
  })

  it('covers only the half a half-day holiday names', () => {
    const index = buildHolidayIndex([
      entry({ start_half: 'pm', days: [{ date: '2026-04-06', halves: ['pm'] }] }),
    ])
    expect(holidayStateFor('m-1', '2026-04-06', 'am', index)).toBeNull()
    expect(holidayStateFor('m-1', '2026-04-06', 'pm', index)).toBe('holiday')
  })
})

describe('coverageSummary', () => {
  const team = [member('m-1', 'Ana'), member('m-2', 'Ben'), member('m-3', 'Cy')]

  it('says everyone when nobody works it', () => {
    expect(coverageSummary(entry(), team)).toBe('Easter Monday: everyone (3)')
  })

  it('names who works it', () => {
    const worked = entry({ exceptions: [{ member_id: 'm-2', day: '2026-04-06' }] })
    expect(coverageSummary(worked, team)).toBe('Easter Monday: 2 of 3 members (Ben work)')
  })

  it('counts only members on the team on its days', () => {
    const joined = [...team, member('m-4', 'Dee', { active_from: '2026-05-01' })]
    expect(coverageSummary(entry(), joined)).toBe('Easter Monday: everyone (3)')
  })
})

describe('stripRows', () => {
  it('lays entries out as gaps and spans over the window', () => {
    const rows = stripRows([entry()], '2026-04-01', '2026-04-10')
    expect(rows).toHaveLength(1)
    expect(rows[0].map((s) => [s.kind, s.days])).toEqual([['gap', 5], ['entry', 1], ['gap', 4]])
  })

  it('stacks overlapping entries into separate rows', () => {
    const shutdown = entry({
      system_id: 'h-2', label: 'Shutdown', start_date: '2026-04-06', end_date: '2026-04-08',
      days: ['2026-04-06', '2026-04-07', '2026-04-08'].map((date) => ({ date, halves: ['am', 'pm'] })),
    })
    const rows = stripRows([entry(), shutdown], '2026-04-01', '2026-04-10')
    expect(rows).toHaveLength(2)
  })

  it('clips an entry to the window, and drops one outside it', () => {
    const before = entry({ start_date: '2026-03-01', end_date: '2026-03-01', days: [{ date: '2026-03-01', halves: ['am', 'pm'] }] })
    expect(stripRows([before], '2026-04-01', '2026-04-10')).toEqual([])
  })
})

describe('holidaySpan', () => {
  it('names half days', () => {
    expect(holidaySpan({ start_date: '2026-12-24', start_half: 'pm', end_date: '2026-12-24', end_half: 'pm' }))
      .toBe('2026-12-24 afternoon')
    expect(holidaySpan({ start_date: '2026-12-31', start_half: 'am', end_date: '2026-12-31', end_half: 'am' }))
      .toBe('2026-12-31 morning')
    expect(holidaySpan({ start_date: '2026-04-03', end_date: '2026-04-06' })).toBe('2026-04-03 – 2026-04-06')
  })
})
