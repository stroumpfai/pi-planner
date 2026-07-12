export const FEATURE_BORDER_COLORS = [
  'border-sky-400',
  'border-emerald-400',
  'border-violet-400',
  'border-rose-400',
  'border-teal-400',
  'border-orange-400',
  'border-indigo-400',
  'border-pink-400',
] as const

export const FEATURE_CHIP_CLASSES = [
  'bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  'bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
  'bg-rose-50 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
  'bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
  'bg-orange-50 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  'bg-pink-50 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
] as const

export function getFeatureColorIdx(featureSystemId: string): number {
  let h = 0
  for (let i = 0; i < featureSystemId.length; i++) {
    h = (h * 31 + featureSystemId.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(h) % FEATURE_BORDER_COLORS.length
}

// Resolve the earliest ancestor (lineage root) of a feature by walking the
// `continued_from_feature_id` chain. Keying the color off the root makes every
// slice of a split feature share the origin's color across the PIs it spans.
// Falls back to the input id when the root can't be resolved (e.g. list still
// loading); the `seen` guard terminates on any accidental cycle.
export function lineageRootId(
  featureSystemId: string,
  byId: Map<string, { system_id: string; continued_from_feature_id: string | null }>,
): string {
  const seen = new Set<string>()
  let cur = byId.get(featureSystemId)
  while (
    cur?.continued_from_feature_id &&
    byId.has(cur.continued_from_feature_id) &&
    !seen.has(cur.system_id)
  ) {
    seen.add(cur.system_id)
    cur = byId.get(cur.continued_from_feature_id)
  }
  return cur?.system_id ?? featureSystemId
}
