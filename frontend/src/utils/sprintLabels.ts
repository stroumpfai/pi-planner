/**
 * Sprint labels, shared by every team view that has a time axis (teams.md §7.0.1).
 *
 * The label is `{PI name}.{n}` with *n* **1-based**, matching the board's own
 * "Sprint 1…5" over stored indices 0–4. PI names are free text up to 100
 * characters, so this compacts well for a PI called `8` and badly for one called
 * `Release train 2026 H2` — which is why truncation is here and not in the API:
 * how much fits a column is a display question, and an agent reading the same
 * data should never receive a name with an ellipsis in it.
 *
 * **The PI part truncates; the sprint number never does.** The number is the half
 * that tells adjacent columns apart, and a column reading `Release trai…` twice
 * is worse than useless.
 */

const ELLIPSIS = '…'

export function sprintLabel(piName: string, sprintNumber: number, maxPiChars = 12): string {
  const pi =
    piName.length > maxPiChars ? `${piName.slice(0, Math.max(1, maxPiChars - 1))}${ELLIPSIS}` : piName
  return `${pi}.${sprintNumber}`
}

/** The dates beneath a column head — "6–17 Apr", or "—" when either is missing. */
export function sprintDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const from = new Date(start)
  const to = new Date(end)
  const day = (d: Date) => d.getUTCDate()
  const month = (d: Date) => d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  return month(from) === month(to)
    ? `${day(from)}–${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`
}

/** One decimal, which is all a capacity figure is ever displayed to (§5.4). */
export const fmt1 = (value: number): string => value.toFixed(1)
