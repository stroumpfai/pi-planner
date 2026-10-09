/**
 * The hand-test files in `docs/csv-samples/` still read as their README says.
 *
 * Only the parser's half is pinned here — errors, date format, what each row
 * becomes. What an import then does to a project is the backend's, and is
 * covered by its own suites; these files are for trying it out by hand.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseImportCSV } from '../csvParser'

const DIR = resolve(__dirname, '../../../../docs/csv-samples')
const parse = (name: string) => parseImportCSV(readFileSync(resolve(DIR, name), 'utf8'))

const WITH_ERRORS = new Set(['09-errors.csv', '15-dates-conflicting.csv'])

describe('docs/csv-samples', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.csv')).sort()

  it.each(files.filter((f) => !WITH_ERRORS.has(f)))('%s parses without errors', (name) => {
    expect(parse(name).errors).toEqual([])
  })

  it('09-errors.csv lists one of each validation error, by line', () => {
    expect(parse('09-errors.csv').errors.map((e) => e.row).sort((a, b) => a - b))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 10, 11])
  })

  it('14-dates-day-first.csv reads day.month.year, and a decimal comma', () => {
    const result = parse('14-dates-day-first.csv')
    expect(result.dateFormat).toMatchObject({ kind: 'one', format: 'dmy_dot' })
    expect(result.rows.find((r) => r.userId === 204)?.effort).toBe(0.5)
  })

  it('15-dates-conflicting.csv is refused on the date no format shares', () => {
    const result = parse('15-dates-conflicting.csv')
    expect(result.dateFormat.kind).toBe('none')
    expect(result.errors.map((e) => e.row)).toEqual([3])
  })

  it('16-story-bug-switch.csv has no State column, so the switch clears States', () => {
    const result = parse('16-story-bug-switch.csv')
    expect(result.hasStateColumn).toBe(false)
    expect(result.rows.map((r) => [r.userId, r.itemType])).toEqual([[202, 'bug'], [301, 'story']])
  })

  it('17-blank-ids.csv rows carry no ID, so every import creates them anew', () => {
    expect(parse('17-blank-ids.csv').rows.map((r) => r.userId)).toEqual([null, null])
  })
})
