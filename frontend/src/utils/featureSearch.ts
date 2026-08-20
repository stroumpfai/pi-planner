import type { Feature } from '@/types'

/** Haystack matched by backlog search: "[101] Auth service". */
export function featureSearchLabel(feature: Pick<Feature, 'id' | 'title'>): string {
  return `${feature.id == null ? '' : `[${feature.id}] `}${feature.title}`
}

/**
 * Case-insensitive substring match over the feature's user ID and title.
 * An empty or whitespace-only query matches everything. Matching is independent
 * of the `showIds` setting — the ID stays searchable even when IDs are hidden.
 */
export function matchesFeatureQuery(feature: Pick<Feature, 'id' | 'title'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return featureSearchLabel(feature).toLowerCase().includes(q)
}
