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
  'bg-sky-50 text-sky-700',
  'bg-emerald-50 text-emerald-700',
  'bg-violet-50 text-violet-700',
  'bg-rose-50 text-rose-700',
  'bg-teal-50 text-teal-700',
  'bg-orange-50 text-orange-700',
  'bg-indigo-50 text-indigo-700',
  'bg-pink-50 text-pink-700',
] as const

export function getFeatureColorIdx(featureSystemId: string): number {
  let h = 0
  for (let i = 0; i < featureSystemId.length; i++) {
    h = (h * 31 + featureSystemId.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(h) % FEATURE_BORDER_COLORS.length
}
