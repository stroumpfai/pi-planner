import { CapacityBar } from './CapacityBar'
import type { Sprint } from '@/types'

interface Props {
  readonly sprint: Sprint
  readonly usedEffort: number
  readonly onEditCapacity?: () => void
}

export function SprintColumnHeader({ sprint, usedEffort, onEditCapacity }: Props) {
  const label = `Sprint ${(sprint.sprint_index ?? 0) + 1}`
  const dates = sprint.start_date && sprint.end_date
    ? `${sprint.start_date} – ${sprint.end_date}`
    : null

  return (
    <div className="p-2 border-b border-gray-200 bg-gray-50 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        {onEditCapacity && (
          <button
            type="button"
            onClick={onEditCapacity}
            className="text-xs text-gray-400 hover:text-blue-500"
            title="Edit capacity"
          >
            ✎
          </button>
        )}
      </div>
      {dates && <p className="text-xs text-gray-400">{dates}</p>}
      <CapacityBar used={usedEffort} capacity={sprint.capacity ?? 0} />
    </div>
  )
}
