import type { PIEvent, PIEventType, Sprint } from '@/types'

export interface EventTypeConfig {
  label: string
  icon: string
  colorClass: string
}

export const EVENT_TYPE_CONFIG: Record<PIEventType, EventTypeConfig> = {
  release:   { label: 'Release',    icon: '🏁', colorClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  milestone: { label: 'Milestone',  icon: '⚑',  colorClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  deadline:  { label: 'Deadline',   icon: '⏰', colorClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  pilot:     { label: 'Pilot',      icon: '🚀', colorClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  go_no_go:  { label: 'Go/No-Go',  icon: '⚖️', colorClass: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  other:     { label: 'Other',      icon: '📌', colorClass: 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-300' },
}

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_CONFIG).map(([value, cfg]) => ({
  value: value as PIEventType,
  label: cfg.label,
}))

function dateToMs(iso: string): number {
  return new Date(iso).getTime()
}

export function assignEventToSprintIndex(eventDate: string, sprints: Sprint[]): number {
  if (sprints.length === 0) return 0

  const evMs = dateToMs(eventDate)

  // 1. Exact date-range match
  for (const s of sprints) {
    if (s.start_date && s.end_date) {
      const start = dateToMs(s.start_date)
      const end = dateToMs(s.end_date)
      if (evMs >= start && evMs <= end) return s.sprint_index ?? 0
    }
  }

  // 2. Find sprint with nearest midpoint or boundary
  const sprintsWithDates = sprints.filter((s) => s.start_date || s.end_date)
  if (sprintsWithDates.length > 0) {
    let nearest = sprintsWithDates[0]
    let minDist = Infinity
    for (const s of sprintsWithDates) {
      const start = s.start_date ? dateToMs(s.start_date) : null
      const end = s.end_date ? dateToMs(s.end_date) : null
      const mid = start != null && end != null
        ? (start + end) / 2
        : (start ?? end ?? 0)
      const dist = Math.abs(evMs - mid)
      if (dist < minDist) { minDist = dist; nearest = s }
    }
    return nearest.sprint_index ?? 0
  }

  // 3. No sprint has dates — place in first sprint
  return sprints[0].sprint_index ?? 0
}

export function groupEventsBySprint(events: PIEvent[], sprints: Sprint[]): Map<number, PIEvent[]> {
  const map = new Map<number, PIEvent[]>()
  for (const s of sprints) {
    map.set(s.sprint_index ?? 0, [])
  }
  for (const ev of events) {
    const idx = assignEventToSprintIndex(ev.event_date, sprints)
    const bucket = map.get(idx) ?? []
    bucket.push(ev)
    map.set(idx, bucket)
  }
  return map
}
