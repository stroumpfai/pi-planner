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

/** Decide the file's format from all of its non-empty date cells. */
export function detectDateFormat(cells: readonly DateCell[]): DateFormatDetection {
  // Contract stub; WP-2A implements it.
  return cells.length === 0 ? { kind: 'no_dates' } : { kind: 'ambiguous', candidates: [] }
}

/**
 * Read one cell under a known format. Any time part (24-hour or AM/PM, with or
 * without seconds) is discarded. Returns `YYYY-MM-DD`, or null when the cell is not
 * a real calendar date under that format.
 */
export function toIsoDate(value: string, format: DateFormat): string | null {
  // Contract stub; WP-2A implements it.
  void value
  void format
  return null
}
