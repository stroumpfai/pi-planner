/** Format an ISO date string (YYYY-MM-DD) as dd.mm.yy for display labels. Returns '?' for null/undefined. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '?'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

/** Convert ISO date (YYYY-MM-DD) to dd.mm.yyyy for date input fields. Returns '' for null/undefined. */
export function toInputDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** Parse a dd.mm.yyyy user input to ISO YYYY-MM-DD. Returns null for empty or invalid values. */
export function fromInputDate(dmy: string | null | undefined): string | null {
  if (!dmy) return null
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dmy.trim())
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

/** Format an ISO datetime for display, e.g. "Aug 17, 2026, 4:05 PM". Returns `fallback` for null/undefined/empty. */
export function fmtDateTime(iso: string | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
