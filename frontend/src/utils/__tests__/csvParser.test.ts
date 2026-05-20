import { describe, it, expect } from 'vitest'
import { parseImportCSV, buildPreview } from '../csvParser'

// Columns: Work Item Type, Title 1, ID, Effort, Parent, State
const HEADER = 'Work Item Type,Title 1,ID,Effort,Parent,State'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

// ── parseImportCSV ─────────────────────────────────────────────────────────────

describe('parseImportCSV', () => {
  it('parses a feature row correctly', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,8,,'))
    expect(result.errors).toHaveLength(0)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      itemType: 'feature',
      title: 'Auth',
      userId: 101,
      effort: 8,
      parentId: null,
    })
  })

  it('parses a story row with a parent ID', () => {
    const result = parseImportCSV(
      csv('Feature,Auth,101,,,', 'Product Backlog Item,Login,,3,101,'),
    )
    expect(result.errors).toHaveLength(0)
    expect(result.rows[1]).toMatchObject({ itemType: 'story', title: 'Login', parentId: 101 })
  })

  it('uses Title 2 for story title when present', () => {
    const header7 = 'Work Item Type,Title 1,Title 2,ID,Effort,Parent,State'
    const row = 'Product Backlog Item,Parent title,Story title,,3,101,'
    const result = parseImportCSV([header7, row].join('\n'))
    expect(result.rows[0].title).toBe('Story title')
  })

  it('parses a Bug row', () => {
    const result = parseImportCSV(csv('Bug,Login crash,,2,,'))
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].itemType).toBe('bug')
  })

  it('records an error for a missing title', () => {
    const result = parseImportCSV(csv('Feature,,,,, '))
    expect(result.errors.some((e) => /missing title/i.test(e.message))).toBe(true)
  })

  it('records an error for an unknown Work Item Type', () => {
    const result = parseImportCSV(csv('Epic,Something,,,,'))
    expect(result.errors.some((e) => /unknown Work Item Type/i.test(e.message))).toBe(true)
  })

  it('excludes Removed rows and increments removedCount', () => {
    const result = parseImportCSV(
      csv('Feature,Removed Feature,,,,Removed', 'Feature,Active Feature,,,,'),
    )
    expect(result.removedCount).toBe(1)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].title).toBe('Active Feature')
  })

  it('records an error for an out-of-range ID', () => {
    const result = parseImportCSV(csv('Feature,Auth,1000000,,,'))
    expect(result.errors.some((e) => /out of range/i.test(e.message))).toBe(true)
  })

  it('records an error for a duplicate ID within the file', () => {
    const result = parseImportCSV(csv('Feature,Auth One,101,,,', 'Feature,Auth Two,101,,,'))
    expect(result.errors.some((e) => /appears more than once/i.test(e.message))).toBe(true)
  })

  it('returns zero rows and zero errors for a header-only CSV', () => {
    const result = parseImportCSV(HEADER + '\n')
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    expect(result.totalRows).toBe(0)
  })
})

// ── buildPreview ───────────────────────────────────────────────────────────────

describe('buildPreview', () => {
  it('returns hasErrors false and correct counts when no errors', () => {
    const result = parseImportCSV(
      csv('Feature,Auth,101,,,', 'Product Backlog Item,Login,,3,101,'),
    )
    const preview = buildPreview(result)
    expect(preview.hasErrors).toBe(false)
    expect(preview.featureCount).toBe(1)
    expect(preview.storyCount).toBe(1)
    expect(preview.orphanCount).toBe(0)
  })

  it('returns hasErrors true when parse result has errors', () => {
    const result = parseImportCSV(csv('Feature,,,,,'))
    const preview = buildPreview(result)
    expect(preview.hasErrors).toBe(true)
  })

  it('counts orphan stories when parent ID has no matching feature', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Login,,3,999,'))
    const preview = buildPreview(result)
    expect(preview.orphanCount).toBe(1)
  })

  it('reflects removedRows from the parse result', () => {
    const result = parseImportCSV(
      csv('Feature,Removed,,,, Removed', 'Feature,Active,,,,'),
    )
    const preview = buildPreview(result)
    expect(preview.removedRows).toBe(1)
    expect(preview.totalRows).toBe(2)
  })
})
