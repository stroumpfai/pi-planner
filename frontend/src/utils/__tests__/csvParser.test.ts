import { describe, it, expect } from 'vitest'
import { parseImportCSV, buildPreview, selectImportRows } from '../csvParser'

// Columns: Work Item Type, Title 1, ID, Effort, Parent, State
const HEADER = 'Work Item Type,Title 1,ID,Effort,Parent,State'

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n')
}

// ── Parent column ──────────────────────────────────────────────────────────────

describe('the Parent column', () => {
  const parentOf = (cell: string) => parseImportCSV(csv(`Product Backlog Item,Login,201,3,${cell},`))

  it.each([
    ['a bare ID', '101'],
    ['an ID with the parent title after it', '101: Auth Feature'],
    ['a dash separator', '101 - Auth Feature'],
    ['a space separator', '101 Auth Feature'],
    ['a leading hash', '#101'],
  ])('reads %s', (_label, cell) => {
    const result = parentOf(cell)
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].parentId).toBe(101)
  })

  it('treats a blank Parent as a deliberate orphan, not an error', () => {
    const result = parentOf('')
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].parentId).toBeNull()
  })

  // The finding: this used to yield null and send the story to "Unassigned"
  // without a word, so a whole export in the wrong format looked like it worked.
  it('rejects a cell that names no ID rather than orphaning the story', () => {
    const result = parentOf('Auth Feature')
    expect(result.errors).toEqual([
      { row: 2, message: 'Parent "Auth Feature" does not name an ID' },
    ])
  })

  it('rejects digits that run into other characters', () => {
    expect(parentOf('101abc').errors).toHaveLength(1)
  })

  it('rejects a Parent ID outside the allowed range', () => {
    expect(parentOf('1000000').errors).toEqual([
      { row: 2, message: 'Parent ID 1000000 is out of range (1–999 999)' },
    ])
  })

  it('says nothing about the Parent of a Removed row, which is not imported', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Login,201,3,Auth Feature,Removed'))
    expect(result.errors).toHaveLength(0)
    expect(result.removedCount).toBe(1)
  })
})

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
    const result = parseImportCSV(csv('Task,Something,,,,'))
    expect(result.errors.some((e) => /unknown Work Item Type/i.test(e.message))).toBe(true)
  })

  it('skips an Epic row without an error', () => {
    const result = parseImportCSV(csv('Epic,Something,900,,,'))
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([])
    expect(result.epicCount).toBe(1)
  })

  it('excludes Removed rows and increments removedCount', () => {
    const result = parseImportCSV(
      csv('Feature,Removed Feature,,,,Removed', 'Feature,Active Feature,,,,'),
    )
    expect(result.removedCount).toBe(1)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].title).toBe('Active Feature')
  })

  it('matches the Removed status case-insensitively', () => {
    const result = parseImportCSV(
      csv(
        'Feature,Lower,,,,removed',
        'Feature,Upper,,,,REMOVED',
        'Feature,Spaced,,,, Removed',
        'Feature,Active,,,,',
      ),
    )
    expect(result.removedCount).toBe(3)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].title).toBe('Active')
  })

  it('captures Removed rows that carry a valid ID as removedItems', () => {
    const result = parseImportCSV(
      csv('Feature,Gone,101,,,Removed', 'Product Backlog Item,Gone Story,202,,,Removed'),
    )
    expect(result.removedItems).toHaveLength(2)
    expect(result.removedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 101, itemType: 'feature', title: 'Gone' }),
        expect.objectContaining({ userId: 202, itemType: 'story', title: 'Gone Story' }),
      ]),
    )
  })

  it('does not capture Removed rows without an ID', () => {
    const result = parseImportCSV(csv('Feature,No Id,,,,Removed'))
    expect(result.removedCount).toBe(1)
    expect(result.removedItems).toHaveLength(0)
  })

  it('counts active child rows whose parent feature is Removed but keeps them in rows', () => {
    const result = parseImportCSV(
      csv(
        'Feature,Doomed,101,,,Removed',
        'Product Backlog Item,Child A,201,3,101,',
        'Bug,Child B,202,2,101,',
        'Product Backlog Item,Survivor,203,3,999,',
      ),
    )
    // The rows survive parsing — reconcile has not decided the feature's fate yet.
    expect(result.rows).toHaveLength(3)
    expect(result.removedFeatureIds).toEqual([101])
    expect(result.childrenOfRemovedCount).toBe(2)
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

  // ── Effort value tests ───────────────────────────────────────────────────────

  it('accepts effort=0 as a valid zero-point story', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Story,,0,101,'))
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].effort).toBe(0)
  })

  it('accepts effort=0.5 with period decimal', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Story,,0.5,101,'))
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].effort).toBe(0.5)
  })

  it('accepts effort "0,5" with comma decimal separator (quoted CSV cell)', () => {
    // PapaParse gives us the unquoted string "0,5" when the cell is quoted in the CSV
    const result = parseImportCSV(csv('Product Backlog Item,Story,,"0,5",101,'))
    expect(result.errors).toHaveLength(0)
    expect(result.rows[0].effort).toBe(0.5)
  })

  it('rejects effort=4 as not in the allowed set', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Story,,4,101,'))
    expect(result.errors.some((e) => /not an allowed value/i.test(e.message))).toBe(true)
    expect(result.rows[0].effort).toBeNull()
  })

  it('rejects non-numeric effort', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Story,,XL,101,'))
    expect(result.errors.some((e) => /not a valid number/i.test(e.message))).toBe(true)
  })
})

// ── selectImportRows ──────────────────────────────────────────────────────────

describe('selectImportRows', () => {
  const withRemovedFeature = () =>
    parseImportCSV(
      csv(
        'Feature,Doomed,101,,,Removed',
        'Product Backlog Item,Child A,201,3,101,',
        'Bug,Child B,202,2,101,',
        'Product Backlog Item,Survivor,203,3,999,',
      ),
    )

  it('drops children of a Removed feature when nothing is kept', () => {
    const rows = selectImportRows(withRemovedFeature())
    expect(rows.map((r) => r.title)).toEqual(['Survivor'])
  })

  it('keeps the children of a Removed feature the user chose to keep', () => {
    const rows = selectImportRows(withRemovedFeature(), new Set([101]))
    expect(rows.map((r) => r.title)).toEqual(['Child A', 'Child B', 'Survivor'])
  })

  it('drops children of the Removed features that are still going', () => {
    const result = parseImportCSV(
      csv(
        'Feature,Kept,101,,,Removed',
        'Feature,Doomed,102,,,Removed',
        'Product Backlog Item,Under Kept,201,3,101,',
        'Product Backlog Item,Under Doomed,202,3,102,',
      ),
    )
    const rows = selectImportRows(result, new Set([101]))
    expect(rows.map((r) => r.title)).toEqual(['Under Kept'])
  })

  it('never drops a feature row of its own', () => {
    const result = parseImportCSV(
      csv('Feature,Doomed,101,,,Removed', 'Feature,Nested,102,,101,'),
    )
    expect(selectImportRows(result).map((r) => r.title)).toEqual(['Nested'])
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

  // The backend resolves a Parent against the project as well as the file, so a
  // preview that only looked at the file would promise orphans it will not create.
  it('does not count a story whose parent is a feature the project already holds', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Login,,3,101,'))
    expect(buildPreview(result, new Set([101])).orphanCount).toBe(0)
  })

  it('still counts a story whose parent is in neither the file nor the project', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Login,,3,999,'))
    expect(buildPreview(result, new Set([101])).orphanCount).toBe(1)
  })

  it('treats an absent Parent as an orphan whatever the project holds', () => {
    const result = parseImportCSV(csv('Product Backlog Item,Login,,3,,'))
    expect(buildPreview(result, new Set([101])).orphanCount).toBe(1)
  })

  it('reflects removedRows from the parse result', () => {
    const result = parseImportCSV(
      csv('Feature,Removed,,,, Removed', 'Feature,Active,,,,'),
    )
    const preview = buildPreview(result)
    expect(preview.removedRows).toBe(1)
    expect(preview.totalRows).toBe(2)
  })

  it('reflects children dropped with a removed parent feature', () => {
    const result = parseImportCSV(
      csv('Feature,Doomed,101,,,Removed', 'Product Backlog Item,Child,201,3,101,'),
    )
    const preview = buildPreview(result)
    expect(preview.childrenRemovedWithParent).toBe(1)
    expect(preview.storyCount).toBe(0)
  })
})

// ── State column ──────────────────────────────────────────────────────────────

describe('State column', () => {
  it('captures the State cell on each row', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,8,,In Progress'))
    expect(result.rows[0].state).toBe('In Progress')
  })

  it('trims surrounding whitespace from the State cell', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,8,,  Done  '))
    expect(result.rows[0].state).toBe('Done')
  })

  it('reports an empty State for a blank cell', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,8,,'))
    expect(result.rows[0].state).toBe('')
  })

  it('flags hasStateColumn when the header includes State', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,8,,New'))
    expect(result.hasStateColumn).toBe(true)
  })

  it('clears hasStateColumn when the file has no State header', () => {
    const noState = [
      'Work Item Type,Title 1,ID,Effort,Parent',
      'Feature,Auth,101,8,',
    ].join('\n')
    const result = parseImportCSV(noState)
    expect(result.hasStateColumn).toBe(false)
    expect(result.rows[0].state).toBe('')
  })

  it('collects distinct States in the preview, deduped case-insensitively', () => {
    const result = parseImportCSV(
      csv(
        'Feature,Auth,101,8,,Done',
        'Feature,Payments,102,8,,done',
        'Feature,Search,103,8,,In Progress',
      ),
    )
    const preview = buildPreview(result)
    expect(preview.stateValues).toEqual(['Done', 'In Progress'])
  })

  it('omits blank States from the preview list', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,8,,', 'Feature,Pay,102,8,,New'))
    expect(buildPreview(result).stateValues).toEqual(['New'])
  })

  it('does not collect States from Removed rows', () => {
    const result = parseImportCSV(
      csv('Feature,Gone,101,8,,Removed', 'Feature,Auth,102,8,,New'),
    )
    expect(buildPreview(result).stateValues).toEqual(['New'])
  })
})

// ── Iteration Path ──────────────────────────────────────────────────────────────

describe('the Iteration Path column', () => {
  const withIteration = (...rows: string[]) =>
    ['Work Item Type,Title 1,ID,Parent,Iteration Path', ...rows].join('\n')

  it('reads the path, trimmed, and says the file has the column', () => {
    const result = parseImportCSV(withIteration(
      'Feature,Auth,101,," Planner\\PI 08 "',
      'Product Backlog Item,Login,201,101,',
    ))
    expect(result.hasIterationColumn).toBe(true)
    expect(result.rows.map((r) => r.iteration)).toEqual(['Planner\\PI 08', ''])
    const preview = buildPreview(result)
    expect(preview.hasIterationColumn).toBe(true)
    expect(preview.iterationCount).toBe(1)
  })

  it('reports no column for a file without one', () => {
    const result = parseImportCSV(csv('Feature,Auth,101,,,New'))
    expect(result.hasIterationColumn).toBe(false)
    expect(result.rows[0].iteration).toBe('')
    expect(buildPreview(result).iterationCount).toBe(0)
  })
})

// ── The two Azure DevOps exports ───────────────────────────────────────────────

// Excerpts of the two real exports: the planner one (no Epic rows, two title
// levels) and the one with Epic rows, a third title level, Area Path and State
// Change Date. Both must read to the same items.
const PLANNER_EXPORT = [
  'ID,Work Item Type,Title 1,Title 2,Effort,Parent,Iteration Path,Committed,State,Closed Date,Resolved Date',
  '"142115","Feature","Logo Endpunkt",,,"113703","ASTRA_ISK",,"New",,',
  '"142109","Product Backlog Item",,"Reenable the logo endpoint","3","142115","ASTRA_ISK\\PI 08\\Sprint 08.2","Yes","Done","9/22/2026 9:56:21 AM",',
  '"151042","Product Backlog Item","ISK - Middleware Migration",,,,"ASTRA_ISK\\PI 08\\Sprint 08.3",,"In Progress",,',
  '"157702","Bug","Finding re-open a mission",,,,"ASTRA_ISK\\PI 08\\Sprint 08.3",,"In Progress",,',
].join('\n')

const EPIC_EXPORT = [
  'ID,Work Item Type,Title 1,Title 2,Title 3,Effort,Parent,Iteration Path,Committed,State,State Change Date,Closed Date,Resolved Date,Area Path',
  '"113703","Epic","Organisationen",,,,,"ASTRA_ISK",,"In Progress","12/17/2025 9:12:00 AM",,,"ASTRA_ISK"',
  '"142115","Feature",,"Logo Endpunkt",,,"113703","ASTRA_ISK",,"New","9/24/2025 12:05:20 PM",,,"ASTRA_ISK"',
  '"142109","Product Backlog Item",,,"Reenable the logo endpoint","3","142115","ASTRA_ISK\\PI 08\\Sprint 08.2","Yes","Done","9/22/2026 9:56:21 AM","9/22/2026 9:56:21 AM",,"ASTRA_ISK\\ISK Development"',
  '"151042","Product Backlog Item","ISK - Middleware Migration",,,,,"ASTRA_ISK\\PI 08\\Sprint 08.3",,"In Progress","6/10/2026 9:41:31 AM",,,"ASTRA_ISK\\ISK ISC-EJPD"',
  '"157702","Bug","Finding re-open a mission",,,,,"ASTRA_ISK\\PI 08\\Sprint 08.3",,"In Progress","9/23/2026 3:44:12 PM",,,"ASTRA_ISK\\ISK Development"',
].join('\n')

describe('the two Azure DevOps exports', () => {
  const core = (text: string) => parseImportCSV(text).rows.map((r) => ({
    itemType: r.itemType, userId: r.userId, title: r.title, effort: r.effort,
    parentId: r.parentId, state: r.state, completion: r.completion,
    iteration: r.iteration, committed: r.committed,
  }))

  it('reads both without errors', () => {
    expect(parseImportCSV(PLANNER_EXPORT).errors).toEqual([])
    expect(parseImportCSV(EPIC_EXPORT).errors).toEqual([])
  })

  it('reads the same items from both', () => {
    expect(core(EPIC_EXPORT)).toEqual(core(PLANNER_EXPORT))
    expect(core(EPIC_EXPORT).map((r) => r.title)).toEqual([
      'Logo Endpunkt', 'Reenable the logo endpoint', 'ISK - Middleware Migration', 'Finding re-open a mission',
    ])
  })

  it('skips Epic rows, counting them apart from Removed', () => {
    const result = parseImportCSV(EPIC_EXPORT)
    expect(result.epicCount).toBe(1)
    expect(result.removedCount).toBe(0)
    expect(result.rows.some((r) => r.userId === 113703)).toBe(false)
    expect(buildPreview(result).epicCount).toBe(1)
  })

  it('gives a feature the title of the Epic its Parent names', () => {
    const feature = parseImportCSV(EPIC_EXPORT).rows.find((r) => r.userId === 142115)
    expect(feature?.parentId).toBe(113703)
    expect(feature?.epicTitle).toBe('Organisationen')
  })

  it('leaves the Epic title unknown when the file has no Epic row', () => {
    const feature = parseImportCSV(PLANNER_EXPORT).rows.find((r) => r.userId === 142115)
    expect(feature?.parentId).toBe(113703)
    expect(feature?.epicTitle).toBeNull()
  })

  it('finds an Epic listed after its feature', () => {
    const [header, epic, ...rest] = EPIC_EXPORT.split('\n')
    const feature = parseImportCSV([header, ...rest, epic].join('\n')).rows.find((r) => r.userId === 142115)
    expect(feature?.epicTitle).toBe('Organisationen')
  })

  it('reads Area Path, Committed and State Change Date', () => {
    const story = parseImportCSV(EPIC_EXPORT).rows.find((r) => r.userId === 142109)
    expect(story?.areaPath).toBe('ASTRA_ISK\\ISK Development')
    expect(story?.committed).toBe(true)
    expect(story?.stateChange).toBe('9/22/2026 9:56:21 AM')
    const uncommitted = parseImportCSV(EPIC_EXPORT).rows.find((r) => r.userId === 151042)
    expect(uncommitted?.committed).toBe(false)
  })

  it('reports which Azure DevOps columns each export has', () => {
    const planner = parseImportCSV(PLANNER_EXPORT)
    expect([planner.hasParentColumn, planner.hasAreaPathColumn, planner.hasCommittedColumn, planner.hasStateChangeDateColumn])
      .toEqual([true, false, true, false])
    const epic = parseImportCSV(EPIC_EXPORT)
    expect([epic.hasParentColumn, epic.hasAreaPathColumn, epic.hasCommittedColumn, epic.hasStateChangeDateColumn])
      .toEqual([true, true, true, true])
  })

  it('reads State Change Date into the file\'s one date format', () => {
    const result = parseImportCSV(EPIC_EXPORT)
    expect(result.dateFormat.kind).toBe('one')
  })
})
