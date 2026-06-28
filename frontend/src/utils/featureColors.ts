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
