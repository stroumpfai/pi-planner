import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useFeatures } from '@/hooks/useFeatures'
import { useEffortUnit } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Feature } from '@/types'

export interface FeatureDragData {
  type: 'feature'
  featureId: string
  fromLocation: 'backlog' | 'pi'
  fromSwimlaneId?: string | null
}

interface ItemProps {
  readonly feature: Feature
  readonly effortUnit: string
  readonly showEffortUnit: boolean
}

function DraggableBacklogItem({ feature, effortUnit, showEffortUnit }: ItemProps) {
  const showIds = useSettingsStore((s) => s.showIds)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `feature:${feature.system_id}`,
    data: {
      type: 'feature',
      featureId: feature.system_id,
      fromLocation: 'backlog',
    } satisfies FeatureDragData,
  })

  const displayId = showIds && feature.id != null ? `[${feature.id}] ` : ''

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`px-2 py-1.5 rounded-lg bg-canvas text-sm select-none cursor-grab active:cursor-grabbing transition-all ${
        isDragging
          ? 'opacity-40 shadow-soft-sm border border-blue-300'
          : 'shadow-soft-sm hover:shadow-soft'
      } text-gray-800 dark:text-gray-200`}
    >
      {displayId && (
        <span className="font-mono text-xs text-gray-400">{displayId}</span>
      )}
      <span className="text-gray-800 dark:text-gray-200">{feature.title}</span>
      {feature.effort != null && (
        <span className="ml-1 text-xs text-purple-600 font-medium">{feature.effort}{showEffortUnit ? effortUnit : ''}</span>
      )}
    </div>
  )
}

interface Props {
  readonly projectId: string
}

export function BacklogPanel({ projectId }: Props) {
  const { data: features, isLoading } = useFeatures(projectId)
  const backlogFeatures = features?.filter((f) => f.location === 'backlog') ?? []
  const effortUnit = useEffortUnit(projectId)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const totalEffort = backlogFeatures.reduce((sum, f) => sum + (f.effort ?? 0), 0)

  const { setNodeRef, isOver } = useDroppable({
    id: 'backlog',
    data: { type: 'backlog' },
  })

  return (
    <div className="flex flex-col h-full border-r border-white/50 dark:border-white/8 bg-canvas w-48 flex-shrink-0">
      <div className="px-3 py-4 border-b border-white/60 dark:border-white/10 bg-band flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Backlog</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 bg-canvas shadow-soft-sm rounded-full px-1.5">
          {backlogFeatures.length}
        </span>
        {totalEffort > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{totalEffort}{showEffortUnit ? ` ${effortUnit}` : ''}</span>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto p-2 space-y-1.5 transition-colors ${
          isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
        }`}
      >
        {isLoading && <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">Loading…</p>}
        {!isLoading && backlogFeatures.length === 0 && (
          <p className="text-xs text-gray-300 dark:text-gray-600 py-6 text-center">
            {isOver ? 'Drop here' : 'Empty'}
          </p>
        )}
        {!isLoading && backlogFeatures.length > 0 && (
          backlogFeatures.map((f) => (
            <DraggableBacklogItem key={f.system_id} feature={f} effortUnit={effortUnit} showEffortUnit={showEffortUnit} />
          ))
        )}
        {backlogFeatures.length > 0 && isOver && (
          <div className="h-8 rounded border-2 border-dashed border-blue-300 flex items-center justify-center">
            <span className="text-xs text-blue-400">Return to backlog</span>
          </div>
        )}
      </div>
    </div>
  )
}
