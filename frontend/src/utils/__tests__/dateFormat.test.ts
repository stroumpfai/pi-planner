import { describe, it, expect } from 'vitest'
import { detectDateFormat, toIsoDate, type DateCell } from '../dateFormat'

/** One cell per value, on consecutive rows of a `Changed Date` column. */
function cells(...values: string[]): DateCell[] {
  return values.map((value, i) => ({ row: i + 2, column: 'Changed Date', value }))
}

// ── toIsoDate ──────────────────────────────────────────────────────────────────

describe('toIsoDate', () => {
  it.each([
    ['iso', '2026-09-03', '2026-09-03'],
    ['iso', '2026-9-3', '2026-09-03'],
    ['iso', '2026-09-03T15:06:02', '2026-09-03'],
    ['iso', '2026-09-03T15:06:02Z', '2026-09-03'],
    ['iso', '2026-09-03T15:06:02.123+02:00', '2026-09-03'],
    ['iso', '2026-09-03 15:06', '2026-09-03'],
    ['dmy_dot', '3.9.2026', '2026-09-03'],
    ['dmy_dot', '03.09.2026 15:06', '2026-09-03'],
    ['dmy_dot', '03.09.2026 15:06:02', '2026-09-03'],
    ['mdy_slash', '9/3/2026 3:06:02 PM', '2026-09-03'],
    ['mdy_slash', '12/5/2025 9:16:20 am', '2025-12-05'],
    ['dmy_slash', '3/9/2026 15:06:02', '2026-09-03'],
    ['dmy_slash', '  3/9/2026  ', '2026-09-03'],
  ] as const)('reads %s %j as %s, zero-padded and without its time', (format, value, expected) => {
    expect(toIsoDate(value, format)).toBe(expected)
  })

  it('reads the same slash cell differently under each order', () => {
    expect(toIsoDate('6/3/2026', 'mdy_slash')).toBe('2026-06-03')
    expect(toIsoDate('6/3/2026', 'dmy_slash')).toBe('2026-03-06')
  })

  it.each([
    ['31 September', '31.9.2026', 'dmy_dot'],
    ['29 February in a common year', '29.02.2026', 'dmy_dot'],
    ['29 February 2027 day-first', '29/2/2027', 'dmy_slash'],
    ['29 February 2027 month-first (month 29)', '29/2/2027', 'mdy_slash'],
    ['29 February 1900 (not a leap year)', '1900-02-29', 'iso'],
    ['a month above 12', '9/22/2026', 'dmy_slash'],
    ['month zero', '2026-00-10', 'iso'],
    ['day zero', '0.9.2026', 'dmy_dot'],
    ['a two-digit year', '9/3/26', 'mdy_slash'],
    ['a two-digit dotted year', '3.9.26', 'dmy_dot'],
    ['another format\'s separator', '3.9.2026', 'mdy_slash'],
    ['slashes read as ISO', '9/3/2026', 'iso'],
    ['an hour past 23', '3.9.2026 24:00', 'dmy_dot'],
    ['a 24-hour hour with PM', '9/3/2026 13:00 PM', 'mdy_slash'],
    ['hour zero with AM', '9/3/2026 0:30 AM', 'mdy_slash'],
    ['minute 60', '9/3/2026 3:60 PM', 'mdy_slash'],
    ['second 60', '2026-09-03T15:06:60', 'iso'],
    ['a time without minutes', '3.9.2026 15', 'dmy_dot'],
    ['trailing words', '3.9.2026 soon', 'dmy_dot'],
    ['an empty time after T', '2026-09-03T', 'iso'],
    ['a T separator outside ISO', '3.9.2026T15:06', 'dmy_dot'],
    ['plain text', 'yesterday', 'iso'],
  ] as const)('rejects %s (%j as %s)', (_why, value, format) => {
    expect(toIsoDate(value, format)).toBeNull()
  })

  it('accepts 29 February in a leap year', () => {
    expect(toIsoDate('29.02.2028', 'dmy_dot')).toBe('2028-02-29')
    expect(toIsoDate('2/29/2028', 'mdy_slash')).toBe('2028-02-29')
    expect(toIsoDate('2000-02-29', 'iso')).toBe('2000-02-29')
  })

  it('accepts a 24-hour time just after midnight', () => {
    expect(toIsoDate('3/9/2026 0:30', 'dmy_slash')).toBe('2026-09-03')
  })

  it('accepts 12 AM and 12 PM', () => {
    expect(toIsoDate('9/3/2026 12:00 AM', 'mdy_slash')).toBe('2026-09-03')
    expect(toIsoDate('9/3/2026 12:59:59 PM', 'mdy_slash')).toBe('2026-09-03')
  })
})

// ── detectDateFormat ───────────────────────────────────────────────────────────

describe('detectDateFormat', () => {
  it('reports no dates for an empty file', () => {
    expect(detectDateFormat([])).toEqual({ kind: 'no_dates' })
  })

  it('reads the step-0 Azure DevOps sample as month/day/year, decided by a day above 12', () => {
    const result = detectDateFormat(
      cells('9/3/2026 3:06:02 PM', '9/22/2026 5:09:11 PM', '7/14/2025 4:13:02 PM', '12/5/2025 9:16:20 AM'),
    )
    expect(result).toEqual({ kind: 'one', format: 'mdy_slash', decidedBy: '9/22/2026 5:09:11 PM' })
  })

  it('names the first deciding cell in input order', () => {
    const result = detectDateFormat(cells('3/4/2026', '14/7/2025', '22/9/2026'))
    expect(result).toEqual({ kind: 'one', format: 'dmy_slash', decidedBy: '14/7/2025' })
  })

  it('reads dotted dates as day.month.year with nothing to decide between', () => {
    expect(detectDateFormat(cells('03.09.2026 15:06', '3.9.2026'))).toEqual({
      kind: 'one',
      format: 'dmy_dot',
      decidedBy: null,
    })
  })

  it('reads ISO dates, with and without a time', () => {
    expect(detectDateFormat(cells('2026-09-03', '2026-09-22T17:09:11Z', '2025-07-14 16:13'))).toEqual({
      kind: 'one',
      format: 'iso',
      decidedBy: null,
    })
  })

  it('asks when every day is 12 or lower', () => {
    expect(detectDateFormat(cells('3/4/2026', '6/3/2026 10:00'))).toEqual({
      kind: 'ambiguous',
      candidates: ['mdy_slash', 'dmy_slash'],
    })
  })

  it('refuses a file mixing month-first and day-first, blaming the minority cell', () => {
    const input: DateCell[] = [
      { row: 2, column: 'Closed Date', value: '9/22/2026' },
      { row: 3, column: 'Changed Date', value: '9/23/2026' },
      { row: 4, column: 'Changed Date', value: '22/9/2026' },
    ]
    expect(detectDateFormat(input)).toEqual({
      kind: 'none',
      offending: [{ row: 4, column: 'Changed Date', value: '22/9/2026' }],
    })
  })

  it('refuses a file whose only date does not exist', () => {
    const result = detectDateFormat(cells('31.9.2026'))
    expect(result).toEqual({
      kind: 'none',
      offending: [{ row: 2, column: 'Changed Date', value: '31.9.2026' }],
    })
  })

  it('refuses 29 February 2027 under every candidate', () => {
    expect(detectDateFormat(cells('29/2/2027')).kind).toBe('none')
  })

  it('accepts 29 February 2028 day-first', () => {
    expect(detectDateFormat(cells('29/2/2028'))).toEqual({
      kind: 'one',
      format: 'dmy_slash',
      decidedBy: '29/2/2028',
    })
  })

  it('refuses a file mixing separators', () => {
    const result = detectDateFormat(cells('2026-09-03', '2026-09-04', '3.9.2026'))
    expect(result).toEqual({
      kind: 'none',
      offending: [{ row: 4, column: 'Changed Date', value: '3.9.2026' }],
    })
  })

  it('lists the first 20 cells when no candidate reads any of them', () => {
    const values = Array.from({ length: 25 }, (_, i) => `not a date ${i}`)
    const result = detectDateFormat(cells(...values))
    expect(result.kind).toBe('none')
    if (result.kind !== 'none') return
    expect(result.offending).toHaveLength(20)
    expect(result.offending[0]).toEqual({ row: 2, column: 'Changed Date', value: 'not a date 0' })
  })

  it('rejects an AM/PM time with a 24-hour hour, even when the date fits', () => {
    expect(detectDateFormat(cells('9/22/2026 13:00 PM')).kind).toBe('none')
  })
})
