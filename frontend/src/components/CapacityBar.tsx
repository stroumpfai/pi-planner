import { useSettingsStore } from '@/stores/settingsStore'

interface Props {
  readonly used: number
  readonly available: number
  readonly unit?: string
}

function barColor(used: number, available: number): string {
  // Available 0 with effort already placed is the most over-committed a sprint can
  // be, not an absence of information — it must read red, never the "nothing set
  // yet" gray (spec/teams.md §6.2).
  if (available <= 0) return used > 0 ? 'bg-red-500' : 'bg-gray-300'
  const pct = used / available
  if (pct > 1) return 'bg-red-500'
  if (pct >= 0.85) return 'bg-amber-400'
  return 'bg-blue-500'
}

export function CapacityBar({ used, available, unit = 'pts' }: Props) {
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const unitSuffix = showEffortUnit ? ` ${unit}` : ''
  const overWithNoBudget = available <= 0 && used > 0
  // A full red bar is the only honest width for load against no budget: the ratio
  // is undefined, so the label reads "over" rather than a percentage.
  const pct = available > 0 ? Math.min(used / available, 1) : (overWithNoBudget ? 1 : 0)
  let label: string
  if (available > 0) {
    label = `${used}/${available}${unitSuffix} - ${Math.round((used / available) * 100)}%`
  } else if (overWithNoBudget) {
    label = `${used}/0${unitSuffix} - over`
  } else {
    label = `${used}/0${unitSuffix} - 0%`
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
      </div>
      <div className="h-1.5 w-full bg-canvas shadow-soft-inset rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(used, available)}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  )
}
