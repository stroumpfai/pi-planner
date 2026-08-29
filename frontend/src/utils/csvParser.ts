import Papa from 'papaparse'
import { EFFORT_VALUES } from '@/constants/effort'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ItemType = 'feature' | 'story' | 'bug'

export interface ParsedRow {
  rowNumber: number       // 1-based file line number (header = 1, first data row = 2)
  itemType: ItemType
  userId: number | null
  title: string
  effort: number | null
  parentId: number | null
  state: string           // raw State cell, trimmed; '' when blank
}

export interface ParseError {
  row: number
  message: string
}

export interface ParseResult {
  /**
   * Every active (non-Removed) row in the file, including child rows whose parent
   * feature is Removed — those are only dropped by `selectImportRows`, once the
   * reconcile step has settled which Removed features are actually going away.
   */
  rows: ParsedRow[]
  totalRows: number       // all data rows before any filtering
  removedCount: number    // rows dropped because State is 'Removed' (any case)
  removedItems: ParsedRow[]         // Removed rows that carry a valid ID (candidates for deletion)
  removedFeatureIds: number[]       // IDs of the Removed rows that are features
  childrenOfRemovedCount: number    // active child rows a full removal would drop
  hasStateColumn: boolean // false when the file has no State header at all
  errors: ParseError[]
}

export interface ImportPreview {
  totalRows: number
  removedRows: number
  childrenRemovedWithParent: number
  featureCount: number
  storyCount: number
  orphanCount: number     // stories whose Parent names no feature in the file or the project
  hasStateColumn: boolean
  stateValues: string[]   // distinct States found, first-seen spelling, in discovery order
  errors: ParseError[]
  hasErrors: boolean
}

// ── Column name constants ─────────────────────────────────────────────────────

const COL_STATE = 'State'
const COL_ID = 'ID'
const COL_TYPE = 'Work Item Type'
const COL_TITLE1 = 'Title 1'
const COL_TITLE2 = 'Title 2'
const COL_EFFORT = 'Effort'
const COL_PARENT = 'Parent'

const ITEM_TYPE_MAP: Record<string, ItemType> = {
  'Feature': 'feature',
  'Product Backlog Item': 'story',
  'Bug': 'bug',
}

const USER_ID_MIN = 1
const USER_ID_MAX = 999_999

// ── Field parsers ─────────────────────────────────────────────────────────────

function resolveTitle(raw: Record<string, string>, itemType: ItemType): string {
  if (itemType === 'feature') {
    return (raw[COL_TITLE1] ?? '').trim()
  }
  const t2 = (raw[COL_TITLE2] ?? '').trim()
  return t2 === '' ? (raw[COL_TITLE1] ?? '').trim() : t2
}

function parseUserId(
  raw: string,
  rowNumber: number,
  errors: ParseError[],
): number | null {
  const s = raw.trim()
  if (s === '') return null
  if (!/^\d+$/.test(s)) {
    errors.push({ row: rowNumber, message: `ID "${s}" is not a valid integer` })
    return null
  }
  const n = Number.parseInt(s, 10)
  if (n < USER_ID_MIN || n > USER_ID_MAX) {
    errors.push({ row: rowNumber, message: `ID ${n} is out of range (1–999 999)` })
    return null
  }
  return n
}

function parseEffort(
  raw: string,
  rowNumber: number,
  errors: ParseError[],
): number | null {
  const s = raw.trim().replace(',', '.')  // accept "0,5" (comma decimal, quoted CSV cell)
  if (s === '') return null
  const n = Number(s)
  if (Number.isNaN(n)) {
    errors.push({ row: rowNumber, message: `effort "${raw.trim()}" is not a valid number` })
    return null
  }
  if (!(EFFORT_VALUES as readonly number[]).includes(n)) {
    errors.push({
      row: rowNumber,
      message: `effort ${n} is not an allowed value (${EFFORT_VALUES.join(', ')})`,
    })
    return null
  }
  return n
}

/**
 * The forms Azure DevOps writes into a Parent cell.
 *
 * Exports differ by query and by tenant: a bare ID, an ID with the parent's title
 * after it, sometimes with a `#`. All of those identify a parent. A cell holding
 * only a title identifies nothing, and is the case this pattern exists to reject
 * — `Number.parseInt` returned null for it, which read as "no parent" and sent the
 * story to "Unassigned" without a word.
 *
 * The trailing `\b` is what separates `101: Auth` (a parent) from `101abc` (a
 * typo): digits have to end at a boundary, not run into other word characters.
 */
const PARENT_ID = /^#?(\d+)\b/

/** Extract a parent ID without judgement — for Removed rows, which are not imported. */
function parseParentIdLenient(raw: string): number | null {
  const match = PARENT_ID.exec(raw.trim())
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * A blank Parent is a deliberate orphan and always allowed. Anything else is held
 * to the same rule as the ID column: it must name an ID in range, or the file is
 * wrong in a way that would otherwise show up as work silently piling into
 * "Unassigned".
 */
function parseParentId(
  raw: string,
  rowNumber: number,
  errors: ParseError[],
): number | null {
  const s = raw.trim()
  if (s === '') return null

  const match = PARENT_ID.exec(s)
  if (!match) {
    errors.push({ row: rowNumber, message: `Parent "${s}" does not name an ID` })
    return null
  }

  const n = Number.parseInt(match[1], 10)
  if (n < USER_ID_MIN || n > USER_ID_MAX) {
    errors.push({ row: rowNumber, message: `Parent ID ${n} is out of range (1–999 999)` })
    return null
  }
  return n
}

/** Parse an ID without surfacing errors — used for Removed rows, which aren't imported. */
function parseUserIdLenient(raw: string): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number.parseInt(s, 10)
  return n >= USER_ID_MIN && n <= USER_ID_MAX ? n : null
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseImportCSV(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  const errors: ParseError[] = []

  // Surface papaparse structural errors as row 0 (file-level)
  for (const e of parsed.errors) {
    errors.push({ row: e.row == null ? 0 : e.row + 2, message: e.message })
  }

  const allDataRows = parsed.data
  const totalRows = allDataRows.length

  // A file with no State column says nothing about State, so the import must leave it
  // alone rather than read every row as blank and clear the whole project.
  const hasStateColumn = (parsed.meta.fields ?? []).includes(COL_STATE)

  const rows: ParsedRow[] = []
  const removedItems: ParsedRow[] = []
  let removedCount = 0

  allDataRows.forEach((raw, index) => {
    const rowNumber = index + 2  // +1 for 0-based, +1 for header row

    // Filter removed items (case-insensitive). Capture those with a valid ID so the
    // caller can reconcile them against items already in the project.
    if ((raw[COL_STATE] ?? '').trim().toLowerCase() === 'removed') {
      removedCount++
      const itemType = ITEM_TYPE_MAP[(raw[COL_TYPE] ?? '').trim()]
      const userId = parseUserIdLenient(raw[COL_ID] ?? '')
      if (itemType !== undefined && userId !== null) {
        removedItems.push({
          rowNumber,
          itemType,
          userId,
          title: resolveTitle(raw, itemType),
          effort: null,
          parentId: parseParentIdLenient(raw[COL_PARENT] ?? ''),
          state: '',
        })
      }
      return
    }

    const rawType = (raw[COL_TYPE] ?? '').trim()
    const itemType = ITEM_TYPE_MAP[rawType]

    if (itemType === undefined) {
      errors.push({ row: rowNumber, message: `unknown Work Item Type "${rawType}"` })
      return
    }

    const title = resolveTitle(raw, itemType)
    if (title === '') {
      errors.push({ row: rowNumber, message: 'missing title' })
    }

    const userId = parseUserId(raw[COL_ID] ?? '', rowNumber, errors)
    const effort = parseEffort(raw[COL_EFFORT] ?? '', rowNumber, errors)
    const parentId = parseParentId(raw[COL_PARENT] ?? '', rowNumber, errors)

    rows.push({
      rowNumber,
      itemType,
      userId,
      title,
      effort,
      parentId,
      state: (raw[COL_STATE] ?? '').trim(),
    })
  })

  // Remove-with-parent: a Removed feature takes its child stories too. The rows stay
  // in `rows` — whether they are dropped depends on what the user decides about each
  // Removed feature in reconcile — so this is only the preview count: what would go
  // if every Removed feature is in fact removed.
  const removedFeatureIds = removedItems
    .filter((r) => r.itemType === 'feature')
    .map((r) => r.userId as number)
  const childrenOfRemovedCount =
    rows.length - dropChildrenOf(rows, new Set(removedFeatureIds)).length

  // Intra-file duplicate ID check (across all active rows)
  const seenIds = new Map<number, number>()  // id → first rowNumber
  for (const row of rows) {
    if (row.userId === null) continue
    const first = seenIds.get(row.userId)
    if (first === undefined) {
      seenIds.set(row.userId, row.rowNumber)
    } else {
      errors.push({
        row: row.rowNumber,
        message: `ID ${row.userId} appears more than once in this file (first at row ${first})`,
      })
    }
  }

  return {
    rows, totalRows, removedCount, removedItems, removedFeatureIds,
    childrenOfRemovedCount, hasStateColumn, errors,
  }
}

// ── Import row selection ──────────────────────────────────────────────────────

function dropChildrenOf(rows: readonly ParsedRow[], featureIds: ReadonlySet<number>): ParsedRow[] {
  if (featureIds.size === 0) return [...rows]
  return rows.filter(
    (r) => r.itemType === 'feature' || r.parentId === null || !featureIds.has(r.parentId),
  )
}

/**
 * The rows an import should actually send.
 *
 * A Removed feature takes its child stories with it, so active child rows whose
 * parent feature is Removed in this file are dropped — they must not be imported
 * or orphaned into "Unassigned". `keptFeatureIds` names the Removed features the
 * user chose to *keep* during reconcile: those are staying, so their children are
 * part of the import after all and must not be silently discarded.
 */
export function selectImportRows(
  result: ParseResult,
  keptFeatureIds: ReadonlySet<number> = new Set(),
): ParsedRow[] {
  return dropChildrenOf(
    result.rows,
    new Set(result.removedFeatureIds.filter((id) => !keptFeatureIds.has(id))),
  )
}

// ── Preview builder ───────────────────────────────────────────────────────────

/**
 * Summarise what an import would do.
 *
 * `knownFeatureIds` are the feature IDs the project already holds. The backend
 * resolves a story's Parent against those as well as against the file, so a
 * preview that ignored them would report orphans the import is not going to
 * create — the exact overstatement that made partial files look broken.
 */
export function buildPreview(
  result: ParseResult,
  knownFeatureIds: ReadonlySet<number> = new Set(),
): ImportPreview {
  // Reconcile has not happened yet, so preview the default: every Removed feature
  // goes, taking its children with it.
  const rows = selectImportRows(result)
  const featureIds = new Set<number>()
  let featureCount = 0
  let storyCount = 0

  for (const row of rows) {
    if (row.itemType === 'feature') {
      featureCount++
      if (row.userId !== null) featureIds.add(row.userId)
    } else {
      storyCount++
    }
  }

  const orphanCount = rows
    .filter((r) => r.itemType === 'story' || r.itemType === 'bug')
    .filter((r) => r.parentId === null
      || !(featureIds.has(r.parentId) || knownFeatureIds.has(r.parentId)))
    .length

  // Distinct States across all three lists, deduped the same way the backend does.
  const seenStates = new Map<string, string>()
  for (const row of rows) {
    const key = row.state.trim().toLowerCase()
    if (key !== '' && !seenStates.has(key)) seenStates.set(key, row.state.trim())
  }

  return {
    totalRows: result.totalRows,
    removedRows: result.removedCount,
    childrenRemovedWithParent: result.childrenOfRemovedCount,
    featureCount,
    storyCount,
    orphanCount,
    hasStateColumn: result.hasStateColumn,
    stateValues: [...seenStates.values()],
    errors: result.errors,
    hasErrors: result.errors.length > 0,
  }
}
