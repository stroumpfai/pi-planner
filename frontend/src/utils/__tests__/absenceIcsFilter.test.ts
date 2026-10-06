import {
  NO_FILTER,
  counts,
  facetCounts,
  isExcluded,
  overlaps,
  parseExcludeWords,
  shownRows,
  type ImportFilter,
  type RowChoices,
} from '../absenceIcsFilter'
import type { AbsenceImportCandidate } from '@/types'

const row = (over: Partial<AbsenceImportCandidate> & { start?: string; end?: string | null } = {}): AbsenceImportCandidate => {
  const { start = '2026-11-02', end = start, ...rest } = over
  return {
    source_uid: 'u',
    title: 'Vacation',
    rule: { kind: 'range', start_date: start, end_date: end, start_half: 'am', end_half: 'pm' },
    rule_summary: '',
    member_id: 'm-anna',
    match: 'picked',
    repeats: 'single',
    selected_by_default: true,
    hint: null,
    action: 'create',
    previous: null,
    ...rest,
  }
}

const NAMES: Record<string, string> = { 'm-anna': 'Anna Keller', 'm-ben': 'Ben Ott' }
const nameOf = (id: string) => NAMES[id] ?? '—'

function shown(rows: AbsenceImportCandidate[], filter: Partial<ImportFilter> = {}, words: string[] = [], choices?: RowChoices) {
  const assigned = Object.fromEntries(rows.map((r, i) => [i, r.member_id ?? '']))
  const ticked = Object.fromEntries(rows.map((r, i) => [i, r.selected_by_default]))
  return shownRows(rows, choices ?? { ticked, assigned }, { ...NO_FILTER, ...filter }, words, nameOf)
}

describe('parseExcludeWords', () => {
  it('splits on commas, semicolons and lines, folds case and accents, drops blanks and repeats', () => {
    expect(parseExcludeWords(' Birthday, geburtstag;\nANNIVERSAIRE ,, birthday\nÉté ')).toEqual([
      'birthday', 'geburtstag', 'anniversaire', 'ete',
    ])
  })
})

describe('isExcluded', () => {
  it('matches a word anywhere in the title, ignoring case and accents', () => {
    const words = parseExcludeWords('birthday, geburtstag')
    expect(isExcluded(row({ title: "Ben's BIRTHDAY" }), words)).toBe(true)
    expect(isExcluded(row({ title: 'Geburtstag Anna' }), words)).toBe(true)
    expect(isExcluded(row({ title: 'Vacation' }), words)).toBe(false)
    expect(isExcluded(row({ title: 'Birthday' }), [])).toBe(false)
  })
})

describe('overlaps', () => {
  it('keeps a range reaching into the window and drops one wholly outside it', () => {
    const week = row({ start: '2026-11-02', end: '2026-11-06' })
    expect(overlaps(week, '2026-11-05', '')).toBe(true)
    expect(overlaps(week, '2026-11-07', '')).toBe(false)
    expect(overlaps(week, '', '2026-11-01')).toBe(false)
  })

  it('treats an open-ended weekly rule as running on', () => {
    const weekly = row({ rule: { kind: 'weekly', start_date: '2026-01-07', end_date: null, weekday: 2, halves: ['pm'] } })
    expect(overlaps(weekly, '2027-06-01', '2027-06-30')).toBe(true)
  })
})

describe('shownRows', () => {
  it('hides unmatched rows until asked for', () => {
    const rows = [row(), row({ title: 'Someone else', member_id: null, match: 'none', action: null })]
    expect(shown(rows)).toEqual([0])
    expect(shown(rows, { who: 'all' })).toEqual([0, 1])
  })

  it('searches the title and the member a row is given to', () => {
    const rows = [row(), row({ title: 'Course', member_id: 'm-ben' })]
    expect(shown(rows, { search: 'ott' })).toEqual([1])
    expect(shown(rows, { search: 'VACA' })).toEqual([0])
  })

  it('filters by status, by repeats, by member and by ticked', () => {
    const rows = [
      row({ action: 'update' }),
      row({ repeats: 'yearly', selected_by_default: false }),
      row({ member_id: 'm-ben', repeats: 'weekly' }),
    ]
    expect(shown(rows, { statuses: ['update'] })).toEqual([0])
    expect(shown(rows, { repeats: ['yearly', 'weekly'] })).toEqual([1, 2])
    expect(shown(rows, { memberId: 'm-ben' })).toEqual([2])
    expect(shown(rows, { tickedOnly: [0, 2] })).toEqual([0, 2])
  })

  it('counts an unmatched row as new for the status filter', () => {
    const rows = [row({ member_id: null, match: 'none', action: null })]
    expect(shown(rows, { who: 'all', statuses: ['create'] })).toEqual([0])
    expect(shown(rows, { who: 'all', statuses: ['update'] })).toEqual([])
  })

  it('never shows an excluded row, whatever the filter', () => {
    const rows = [row(), row({ title: 'Birthday Ben' })]
    expect(shown(rows, { who: 'all' }, ['birthday'])).toEqual([0])
  })

  it('narrows by date and sorts what it shows by date', () => {
    const rows = [row({ start: '2026-12-21' }), row({ start: '2026-11-02' }), row({ start: '2027-03-01' })]
    expect(shown(rows)).toEqual([1, 0, 2])
    expect(shown(rows, { from: '2026-11-03', to: '2026-12-31' })).toEqual([0])
  })

  it('filters on the member the user picked, not the one the server matched', () => {
    const rows = [row({ member_id: null, match: 'none', action: null })]
    const choices = { ticked: { 0: true }, assigned: { 0: 'm-ben' } }
    expect(shown(rows, { who: 'all', memberId: 'm-ben' }, [], choices)).toEqual([0])
  })
})

describe('counts', () => {
  it('counts the file before any filter: what the exclude words removed, and what matched nobody', () => {
    const rows = [
      row(),
      row({ member_id: null, match: 'none', action: null }),
      row({ title: 'Birthday', repeats: 'yearly' }),
    ]
    expect(counts(rows, ['birthday'])).toEqual({ total: 3, excluded: 1, unmatched: 1 })
  })
})

describe('the defects found in review', () => {
  const unmatched = (title: string, over: Partial<AbsenceImportCandidate> = {}) =>
    row({ title, member_id: null, match: 'none', action: null, selected_by_default: false, ...over })

  it('narrows to the unmatched rows only, like every other chip', () => {
    const rows = [row(), unmatched('Someone away')]
    expect(shown(rows, { who: 'unmatched' })).toEqual([1])
    expect(shown(rows, { who: 'all' })).toEqual([0, 1])
    expect(shown(rows)).toEqual([0])
  })

  it('counts each chip under the other filters, so a count is what a click shows', () => {
    const rows = [
      row({ title: 'Vacation' }),
      row({ title: 'Birthday Anna', repeats: 'yearly' }),
      unmatched('Birthday Carl', { repeats: 'yearly' }),
      unmatched('Someone away'),
    ]
    const facets = facetCounts(rows, choicesOf(rows), { ...NO_FILTER, search: 'birthday' }, [], nameOf)
    // One matched birthday on screen; the unmatched one is one click away, and says so.
    expect(facets.who).toEqual({ matched: 1, unmatched: 1, all: 2 })
    expect(facets.repeats).toEqual({ yearly: 1 })
    expect(facets.status).toEqual({ create: 1 })
  })

  it('keeps a row on a Ticked-only list when it is unticked there', () => {
    const rows = [row(), row({ title: 'Course' })]
    const filter = { ...NO_FILTER, tickedOnly: [0, 1] }
    const afterUntick = { ticked: { 0: false, 1: true }, assigned: { 0: 'm-anna', 1: 'm-anna' } }
    expect(shown(rows, filter, [], afterUntick)).toEqual([0, 1])
  })
})

function choicesOf(rows: AbsenceImportCandidate[]): RowChoices {
  return {
    ticked: Object.fromEntries(rows.map((r, i) => [i, r.selected_by_default])),
    assigned: Object.fromEntries(rows.map((r, i) => [i, r.member_id ?? ''])),
  }
}

