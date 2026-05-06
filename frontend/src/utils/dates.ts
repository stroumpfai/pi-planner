/** Format an ISO date string (YYYY-MM-DD) as dd.mm.yy. Returns '?' for null/undefined. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '?'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}
