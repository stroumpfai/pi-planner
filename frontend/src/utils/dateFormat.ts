/**
 * Working out which date format a CSV file uses (spec/team-achievement.md §4.3).
 *
 * The format belongs to the machine that exported the file, not to Azure DevOps, so
 * it is never assumed and never guessed cell by cell. One file is one export and
 * one format: every date cell in every date column is evidence, and a candidate is
 * eliminated by any single cell it cannot read as a real calendar date.
 *
 * Contract for step 2 (WP-2A implements `detectDateFormat` and `toIsoDate`;
 * WP-2B's row mapping and WP-2D's dialog consume them).
 */

/** The candidates, in the order the import dialog offers them. */
export type DateFormat = 'iso' | 'dmy_dot' | 'mdy_slash' | 'dmy_slash'

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  iso: 'year-month-day',
  dmy_dot: 'day.month.year',
  mdy_slash: 'month/day/year',
  dmy_slash: 'day/month/year',
}

export type DateFormatDetection =
  /** No date cell in the file at all: nothing to decide. */
  | { kind: 'no_dates' }
  /** Exactly one candidate fits every cell. `decidedBy` is a cell that ruled out the
   *  others, for the preview line; null when only one candidate could ever match
   *  (e.g. ISO or dotted input). */
  | { kind: 'one'; format: DateFormat; decidedBy: string | null }
  /** Several fit every cell (every day ≤ 12): the user must choose. */
  | { kind: 'ambiguous'; candidates: DateFormat[] }
  /** No single candidate reads every cell. */
  | { kind: 'none'; offending: { row: number; column: string; value: string }[] }

export interface DateCell {
  row: number     // 1-based file line number, as ParsedRow.rowNumber
  column: string  // header name
  value: string   // raw, trimmed, non-empty
}

const CANDIDATES = Object.keys(DATE_FORMAT_LABELS) as DateFormat[]

/** How a format is written. Two formats written alike (the slash orders) can only be
 *  told apart by a component that cannot be a month: that cell is what decides. */
const SHAPE: Record<DateFormat, 'dash' | 'dot' | 'slash'> = {
  iso: 'dash',
  dmy_dot: 'dot',
  mdy_slash: 'slash',
  dmy_slash: 'slash',
}

const MAX_OFFENDING = 20

/** Decide the file's format from all of its non-empty date cells. */
export function detectDateFormat(cells: readonly DateCell[]): DateFormatDetection {
  if (cells.length === 0) return { kind: 'no_dates' }

  // For each candidate, the cells it cannot read, in input order.
  const unreadable = new Map<DateFormat, DateCell[]>()
  for (const format of CANDIDATES) {
    unreadable.set(format, cells.filter((cell) => toIsoDate(cell.value, format) === null))
  }
  const missed = (format: DateFormat): DateCell[] => unreadable.get(format) ?? []
  const survivors = CANDIDATES.filter((format) => missed(format).length === 0)

  if (survivors.length === 1) {
    const format = survivors[0]
    return { kind: 'one', format, decidedBy: decidingCell(cells, format, missed) }
  }
  if (survivors.length > 1) return { kind: 'ambiguous', candidates: survivors }
  return { kind: 'none', offending: offendingCells(cells, missed) }
}

/** The earliest cell that ruled out another candidate written the same way as
 *  `format`; null when no such candidate exists (ISO, dotted). */
function decidingCell(
  cells: readonly DateCell[],
  format: DateFormat,
  missed: (format: DateFormat) => DateCell[],
): string | null {
  const indexes = CANDIDATES.filter((other) => other !== format && SHAPE[other] === SHAPE[format])
    .map((other) => missed(other)[0])
    .filter((cell): cell is DateCell => cell !== undefined)
    .map((cell) => cells.indexOf(cell))
  return indexes.length === 0 ? null : cells[Math.min(...indexes)].value
}

/** With no survivor, blame the cells the best-fitting candidate cannot read, or the
 *  first cells of the file when no candidate reads any of them. */
function offendingCells(
  cells: readonly DateCell[],
  missed: (format: DateFormat) => DateCell[],
): DateCell[] {
  let offending: readonly DateCell[] = cells
  let bestRead = 0
  for (const format of CANDIDATES) {
    const read = cells.length - missed(format).length
    if (read > bestRead) {
      bestRead = read
      offending = missed(format)
    }
  }
  return offending.slice(0, MAX_OFFENDING).map(({ row, column, value }) => ({ row, column, value }))
}

// A clock time, H:mm or H:mm:ss with optional fractions; the suffix is checked apart.
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/
const MERIDIEM = /\s?([AP]M)$/i
const UTC_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/

function isValidTime(time: string): boolean {
  const meridiem = MERIDIEM.exec(time)
  const clock = meridiem === null ? time.replace(UTC_OFFSET, '') : time.slice(0, meridiem.index)
  const match = CLOCK.exec(clock)
  if (match === null) return false
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] === undefined ? 0 : Number(match[3])
  if (minute > 59 || second > 59) return false
  return meridiem === null ? hour <= 23 : hour >= 1 && hour <= 12
}

type Part = 'y' | 'm' | 'd'

const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

const PATTERNS: Record<DateFormat, { re: RegExp; order: readonly [Part, Part, Part] }> = {
  iso: { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['y', 'm', 'd'] },
  dmy_dot: { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ['d', 'm', 'y'] },
  mdy_slash: { re: SLASH, order: ['m', 'd', 'y'] },
  dmy_slash: { re: SLASH, order: ['d', 'm', 'y'] },
}

/** Split a cell into its date and optional time part: at the first whitespace, or for
 *  ISO also at a `T`. */
function splitCell(value: string, format: DateFormat): [string, string | null] {
  const separator = format === 'iso' ? /[T\s]/ : /\s/
  const at = value.search(separator)
  return at === -1 ? [value, null] : [value.slice(0, at), value.slice(at + 1).trim()]
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/**
 * Read one cell under a known format. Any time part (24-hour or AM/PM, with or
 * without seconds) is discarded. Returns `YYYY-MM-DD`, or null when the cell is not
 * a real calendar date under that format.
 *
 * Built numerically on purpose: `Date` parsing of a raw string is locale-dependent,
 * which is the very ambiguity this module exists to rule out.
 */
export function toIsoDate(value: string, format: DateFormat): string | null {
  const { re, order } = PATTERNS[format]
  const [datePart, timePart] = splitCell(value.trim(), format)
  const match = re.exec(datePart)
  if (match === null) return null
  if (timePart !== null && !isValidTime(timePart)) return null

  const parts: Record<Part, number> = { y: 0, m: 0, d: 0 }
  order.forEach((part, i) => {
    parts[part] = Number(match[i + 1])
  })
  const { y: year, m: month, d: day } = parts
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null

  const pad = (n: number, width: number): string => String(n).padStart(width, '0')
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}
