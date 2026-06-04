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
}

export interface ParseError {
  row: number
  message: string
}

export interface ParseResult {
  rows: ParsedRow[]
  totalRows: number       // all data rows before any filtering
  removedCount: number    // rows dropped because State === 'Removed'
  errors: ParseError[]
}

export interface ImportPreview {
  totalRows: number
  removedRows: number
  featureCount: number
  storyCount: number
  orphanCount: number     // stories with no resolvable parent feature in the file
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

function parseParentId(raw: string): number | null {
  const s = raw.trim()
  if (s === '') return null
  const n = Number.parseInt(s, 10)
  return Number.isNaN(n) ? null : n
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

  const rows: ParsedRow[] = []
  let removedCount = 0

  allDataRows.forEach((raw, index) => {
    const rowNumber = index + 2  // +1 for 0-based, +1 for header row

    // Filter removed items
    if ((raw[COL_STATE] ?? '').trim() === 'Removed') {
      removedCount++
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
    const parentId = parseParentId(raw[COL_PARENT] ?? '')

    rows.push({ rowNumber, itemType, userId, title, effort, parentId })
  })

  // Intra-file duplicate ID check (across all non-Removed rows)
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

  return { rows, totalRows, removedCount, errors }
}

// ── Preview builder ───────────────────────────────────────────────────────────

export function buildPreview(result: ParseResult): ImportPreview {
  const featureIds = new Set<number>()
  let featureCount = 0
  let storyCount = 0

  for (const row of result.rows) {
    if (row.itemType === 'feature') {
      featureCount++
      if (row.userId !== null) featureIds.add(row.userId)
    } else {
      storyCount++
    }
  }

  const orphanCount = result.rows
    .filter((r) => r.itemType === 'story' || r.itemType === 'bug')
    .filter((r) => r.parentId === null || !featureIds.has(r.parentId))
    .length

  return {
    totalRows: result.totalRows,
    removedRows: result.removedCount,
    featureCount,
    storyCount,
    orphanCount,
    errors: result.errors,
    hasErrors: result.errors.length > 0,
  }
}
