import type { TeamHolidayEntry, TeamMember } from '@/types'
import { daysBetween } from '@/utils/timelineMonths'
import type { Half } from '@/utils/workingDays'

/**
 * What the Absences view draws from a team's enabled holiday calendars
 * (spec/public-holidays.md §5.2, §5.3).
 *
 * The server expands every entry into days and halves — the same generator the
 * capacity figure uses — so nothing here works out *when* a holiday is. This
 * module only indexes those days and answers the two questions the view asks:
 * is this member off for a holiday in this half, and how should the strip above
 * the grid lay the entries out.
 */

/** Which entries cover each `date|half`. Several can: two calendars on one day. */
export type HolidayCoverage = ReadonlyMap<string, readonly TeamHolidayEntry[]>

const slotKey = (date: string, half: Half) => `${date}|${half}`
const exceptionKey = (memberId: string, entryId: string, day: string) => `${memberId}|${entryId}|${day}`

export interface HolidayIndex {
  readonly coverage: HolidayCoverage
  readonly exceptions: ReadonlySet<string>
}

export function buildHolidayIndex(entries: readonly TeamHolidayEntry[]): HolidayIndex {
  const coverage = new Map<string, TeamHolidayEntry[]>()
  const exceptions = new Set<string>()
  for (const entry of entries) {
    for (const day of entry.days) {
      for (const half of day.halves) {
        const key = slotKey(day.date, half)
        const list = coverage.get(key)
        if (list) list.push(entry)
        else coverage.set(key, [entry])
      }
    }
    for (const exception of entry.exceptions) {
      exceptions.add(exceptionKey(exception.member_id, entry.system_id, exception.day))
    }
  }
  return { coverage, exceptions }
}

export const EMPTY_HOLIDAYS: HolidayIndex = { coverage: new Map(), exceptions: new Set() }

export type HolidayState = 'holiday' | 'works-holiday'

/**
 * A member's half-day, as the holidays see it.
 *
 * `holiday` when any entry covering the half has no exception for this member on
 * this day — two calendars union, so working one of them is not working both.
 * `works-holiday` when every covering entry is excepted: the cell is free, and
 * drawn so the correction stays visible.
 */
export function holidayStateFor(
  memberId: string,
  date: string,
  half: Half,
  index: HolidayIndex,
): HolidayState | null {
  const entries = index.coverage.get(slotKey(date, half))
  if (!entries || entries.length === 0) return null
  const off = entries.some((e) => !index.exceptions.has(exceptionKey(memberId, e.system_id, date)))
  return off ? 'holiday' : 'works-holiday'
}

/** The entries covering a half — what a click on a holiday cell is about. */
export function holidaysAt(date: string, half: Half, index: HolidayIndex): readonly TeamHolidayEntry[] {
  return index.coverage.get(slotKey(date, half)) ?? []
}

export function worksHoliday(memberId: string, entryId: string, day: string, index: HolidayIndex): boolean {
  return index.exceptions.has(exceptionKey(memberId, entryId, day))
}

/**
 * Who has this holiday, said plainly: "18 of 20 members (Ana, Ben work)".
 *
 * Counted over the members on the team on at least one of its days. A member
 * with an exception on any day of it counts as working it — the strip states the
 * correction rather than smoothing it over (§5.2).
 */
export function coverageSummary(entry: TeamHolidayEntry, members: readonly TeamMember[]): string {
  const days = entry.days.map((d) => d.date)
  const onTeam = members.filter((m) =>
    days.some((d) => (!m.active_from || d >= m.active_from) && (!m.active_to || d <= m.active_to)),
  )
  const working = new Set(entry.exceptions.map((e) => e.member_id))
  const workers = onTeam.filter((m) => working.has(m.system_id))
  const off = onTeam.length - workers.length
  if (workers.length === 0) return `${entry.label}: everyone (${onTeam.length})`
  return `${entry.label}: ${off} of ${onTeam.length} members (${workers.map((m) => m.name).join(', ')} work)`
}

/** One run of days in the strip: either a gap or an entry, as wide as its days. */
export type StripSegment =
  | { readonly kind: 'gap'; readonly days: number }
  | { readonly kind: 'entry'; readonly days: number; readonly entry: TeamHolidayEntry }

/**
 * The strip's rows, with overlapping entries stacked rather than drawn over each
 * other (§5.2). Greedy by start date: an entry goes in the first row it fits.
 *
 * Whole days, clipped to the window. A half-day holiday still takes its day's
 * column in the strip; the cells below show which half, and the tooltip says so.
 */
export function stripRows(
  entries: readonly TeamHolidayEntry[],
  from: string,
  to: string,
): StripSegment[][] {
  const window = daysBetween(from, to)
  const position = new Map(window.map((day, i) => [day, i]))
  const placed = entries
    .map((entry) => {
      const inside = entry.days.map((d) => position.get(d.date)).filter((i): i is number => i !== undefined)
      return inside.length > 0
        ? { entry, first: Math.min(...inside), last: Math.max(...inside) }
        : null
    })
    .filter((p): p is { entry: TeamHolidayEntry; first: number; last: number } => p !== null)
    .sort((a, b) => a.first - b.first || a.entry.label.localeCompare(b.entry.label))

  const lanes: { last: number; items: typeof placed }[] = []
  for (const item of placed) {
    const lane = lanes.find((l) => l.last < item.first)
    if (lane) {
      lane.items.push(item)
      lane.last = item.last
    } else {
      lanes.push({ last: item.last, items: [item] })
    }
  }

  return lanes.map((lane) => {
    const segments: StripSegment[] = []
    let cursor = 0
    for (const item of lane.items) {
      if (item.first > cursor) segments.push({ kind: 'gap', days: item.first - cursor })
      segments.push({ kind: 'entry', days: item.last - item.first + 1, entry: item.entry })
      cursor = item.last + 1
    }
    if (cursor < window.length) segments.push({ kind: 'gap', days: window.length - cursor })
    return segments
  })
}

/** "24 Dec pm" / "3–6 Apr" — an entry's span in the words the dialogs use. */
export function holidaySpan(entry: {
  start_date: string
  start_half?: Half | null
  end_date?: string | null
  end_half?: Half | null
}): string {
  const end = entry.end_date ?? entry.start_date
  const startHalf = entry.start_half ?? 'am'
  const endHalf = entry.end_half ?? 'pm'
  if (end === entry.start_date) {
    if (startHalf === 'pm') return `${entry.start_date} afternoon`
    if (endHalf === 'am') return `${entry.start_date} morning`
    return entry.start_date
  }
  const open = startHalf === 'pm' ? ' (from the afternoon)' : ''
  const close = endHalf === 'am' ? ' (until noon)' : ''
  return `${entry.start_date}${open} – ${end}${close}`
}
