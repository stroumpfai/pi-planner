import { useSettingsStore } from '@/stores/settingsStore'

interface Props {
  readonly used: number
  readonly capacity: number
  readonly unit?: string
}

function barColor(used: number, capacity: number): string {
  if (capacity === 0) return 'bg-gray-300'
  const pct = used / capacity
  if (pct > 1) return 'bg-red-500'
  if (pct >= 0.85) return 'bg-amber-400'
  return 'bg-blue-500'
}

export function CapacityBar({ used, capacity, unit = 'pts' }: Props) {
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const unitSuffix = showEffortUnit ? ` ${unit}` : ''
  const pct = capacity > 0 ? Math.min(used / capacity, 1) : 0
  const label = capacity > 0
    ? `${used}/${capacity}${unitSuffix} - ${Math.round((used / capacity) * 100)}%`
    : `${used}/0${unitSuffix} - 0%`

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
      </div>
      <div className="h-1.5 w-full bg-canvas shadow-soft-inset rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(used, capacity)}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  )
}
