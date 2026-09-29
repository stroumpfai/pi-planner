/**
 * Completion-date columns in the CSV parser (spec/team-achievement.md §4.3).
 *
 * Format detection itself is WP-2A's, and is tested there; here `@/utils/dateFormat`
 * is mocked, so these tests pin only what the parser hands to detection and what it
 * does with the answer.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DateCell, DateFormatDetection } from '@/utils/dateFormat'
import { detectDateFormat, toIsoDate } from '@/utils/dateFormat'
import { buildPreview, completedOnFor, parseImportCSV, type ParsedRow } from '../csvParser'

vi.mock('@/utils/dateFormat', () => ({
  detectDateFormat: vi.fn(),
  toIsoDate: vi.fn(),
}))

const detect = vi.mocked(detectDateFormat)
const toIso = vi.mocked(toIsoDate)

const ONE_MDY: DateFormatDetection = { kind: 'one', format: 'mdy_slash', decidedBy: '9/22/2026' }

beforeEach(() => {
  detect.mockReset()
  toIso.mockReset()
  detect.mockReturnValue(ONE_MDY)
})

const HEADER = 'Work Item Type,Title 1,ID,State,Closed Date,Resolved Date,Changed Date'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n')

describe('the completion column', () => {
  it('is taken from Closed Date', () => {
    const { rows, errors } = parseImportCSV(csv('Product Backlog Item,Login,201,Done, 9/3/2026 ,9/1/2026,9/22/2026'))
    expect(errors).toEqual([])
    expect(rows[0].completion).toBe('9/3/2026')
  })

  it('falls back to Resolved Date when Closed Date is blank', () => {
    const { rows } = parseImportCSV(csv('Bug,Crash,301,Resolved,,9/18/2026,9/19/2026'))
    expect(rows[0].completion).toBe('9/18/2026')
  })

  it('never uses Changed Date, even when both completion cells are blank', () => {
    const { rows } = parseImportCSV(csv('Product Backlog Item,Login,201,Active,,,9/22/2026'))
    expect(rows[0].completion).toBe('')
  })

  it('is blank in a file without either completion column', () => {
    const result = parseImportCSV('Work Item Type,Title 1,ID,Changed Date\nFeature,Auth,101,9/22/2026')
    expect(result.hasCompletionColumns).toBe(false)
    expect(result.rows[0].completion).toBe('')
  })
})

describe('hasCompletionColumns', () => {
  it.each([
    ['Closed Date only', 'Work Item Type,Title 1,Closed Date', true],
    ['Resolved Date only', 'Work Item Type,Title 1,Resolved Date', true],
    ['neither (Changed Date does not count)', 'Work Item Type,Title 1,Changed Date', false],
    ['no date columns at all', 'Work Item Type,Title 1', false],
  ])('%s', (_label, header, expected) => {
    expect(parseImportCSV(`${header}\nFeature,Auth`).hasCompletionColumns).toBe(expected)
  })
})

describe('date format detection', () => {
  it('is given every non-empty cell of every *Date column, Removed rows included', () => {
    parseImportCSV([
      'Work Item Type,Title 1,ID,State,Closed Date,Created date,Changed Date,Target',
      'Feature,Auth,101,Active,,7/14/2025,9/22/2026,x',
      'Product Backlog Item,Gone,201,Removed,,,9/1/2026,',
      'Product Backlog Item,Login,202,Done,9/3/2026,,9/4/2026,',
    ].join('\n'))

    expect(detect).toHaveBeenCalledTimes(1)
    expect(detect.mock.calls[0][0]).toEqual<DateCell[]>([
      { row: 2, column: 'Created date', value: '7/14/2025' },
      { row: 2, column: 'Changed Date', value: '9/22/2026' },
      { row: 3, column: 'Changed Date', value: '9/1/2026' },
      { row: 4, column: 'Closed Date', value: '9/3/2026' },
      { row: 4, column: 'Changed Date', value: '9/4/2026' },
    ])
  })

  it('reports its answer on the result and the preview', () => {
    const result = parseImportCSV(csv(
      'Product Backlog Item,Login,201,Done,9/3/2026,,9/22/2026',
      'Product Backlog Item,Reset,202,Active,,,9/21/2026',
      'Bug,Crash,301,Resolved,,9/18/2026,9/18/2026',
    ))
    expect(result.dateFormat).toEqual(ONE_MDY)

    const preview = buildPreview(result)
    expect(preview.dateFormat).toEqual(ONE_MDY)
    expect(preview.hasCompletionColumns).toBe(true)
    expect(preview.completionCount).toBe(2)
    expect(preview.hasErrors).toBe(false)
  })

  it('blocks the import with one error per cell when no format reads them all', () => {
    detect.mockReturnValue({
      kind: 'none',
      offending: [
        { row: 2, column: 'Closed Date', value: '13/13/2026' },
        { row: 3, column: 'Changed Date', value: '31.9.2026' },
      ],
    })
    const result = parseImportCSV(csv(
      'Product Backlog Item,Login,201,Done,13/13/2026,,9/22/2026',
      'Product Backlog Item,Reset,202,Active,,,31.9.2026',
    ))

    expect(result.errors).toEqual([
      { row: 2, message: 'Closed Date "13/13/2026": no single date format reads every date in this file' },
      { row: 3, message: 'Changed Date "31.9.2026": no single date format reads every date in this file' },
    ])
    expect(buildPreview(result).hasErrors).toBe(true)
  })

  it('leaves a file without date columns exactly as before', () => {
    detect.mockReturnValue({ kind: 'no_dates' })
    const result = parseImportCSV('Work Item Type,Title 1,ID\nFeature,Auth,101')
    expect(detect).toHaveBeenCalledWith([])
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ userId: 101, title: 'Auth', completion: '' })
    expect(buildPreview(result).completionCount).toBe(0)
  })
})

describe('completedOnFor', () => {
  const row = (completion: string): ParsedRow => ({
    rowNumber: 2, itemType: 'story', userId: 201, title: 'Login',
    effort: null, parentId: null, state: 'Done', completion, iteration: '',
  })

  it('reads the completion cell under the given format', () => {
    toIso.mockReturnValue('2026-09-03')
    expect(completedOnFor(row('9/3/2026 3:06:02 PM'), 'mdy_slash')).toBe('2026-09-03')
    expect(toIso).toHaveBeenCalledWith('9/3/2026 3:06:02 PM', 'mdy_slash')
  })

  it('is null when the cell cannot be read under that format', () => {
    toIso.mockReturnValue(null)
    expect(completedOnFor(row('13/13/2026'), 'dmy_slash')).toBeNull()
  })

  it('is null for a blank completion or an unsettled format, without reading anything', () => {
    expect(completedOnFor(row(''), 'iso')).toBeNull()
    expect(completedOnFor(row('9/3/2026'), null)).toBeNull()
    expect(toIso).not.toHaveBeenCalled()
  })
})

describe('the real ADO sample (docs/csv-samples/10-closed-dates.csv)', () => {
  const text = readFileSync(resolve(__dirname, '../../../../docs/csv-samples/10-closed-dates.csv'), 'utf8')

  it('parses with no errors and takes Closed Date, then Resolved Date', () => {
    const result = parseImportCSV(text)
    expect(result.errors).toEqual([])
    expect(result.hasCompletionColumns).toBe(true)

    const byId = new Map(result.rows.map((r) => [r.userId, r.completion]))
    expect(byId.get(201)).toBe('9/3/2026 3:06:02 PM')   // Changed Date 9/22 ignored
    expect(byId.get(301)).toBe('9/18/2026 2:15:00 PM')  // Closed blank: Resolved used
    expect(byId.get(203)).toBe('')
    expect(buildPreview(result).completionCount).toBe(4)
  })

  it('gives detection the Changed Date of every row', () => {
    parseImportCSV(text)
    const changed = detect.mock.calls[0][0].filter((c) => c.column === 'Changed Date')
    expect(changed).toHaveLength(7)
    expect(changed[1]).toEqual({ row: 3, column: 'Changed Date', value: '9/22/2026 5:09:11 PM' })
  })
})
