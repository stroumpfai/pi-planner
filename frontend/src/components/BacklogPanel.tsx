import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useFeatures } from '@/hooks/useFeatures'
import type { Feature } from '@/types'

export interface FeatureDragData {
  type: 'feature'
  featureId: string
  fromLocation: 'backlog' | 'pi'
  fromSwimlaneId?: string | null
}

interface ItemProps {
  readonly feature: Feature
}

function DraggableBacklogItem({ feature }: ItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `feature:${feature.system_id}`,
    data: {
      type: 'feature',
      featureId: feature.system_id,
      fromLocation: 'backlog',
    } satisfies FeatureDragData,
  })

  const displayId = feature.id != null ? `[${feature.id}] ` : ''

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`px-2 py-1.5 rounded border bg-white text-sm select-none cursor-grab active:cursor-grabbing transition-opacity ${
        isDragging
          ? 'opacity-40 border-blue-400'
          : 'border-gray-200 hover:border-blue-300 hover:shadow-sm'
      }`}
    >
      {displayId && (
        <span className="font-mono text-xs text-gray-400">{displayId}</span>
      )}
      <span className="text-gray-800">{feature.title}</span>
      {feature.effort != null && (
        <span className="ml-1 text-xs text-purple-600 font-medium">{feature.effort}pt</span>
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

  const { setNodeRef, isOver } = useDroppable({
    id: 'backlog',
    data: { type: 'backlog' },
  })

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white w-48 flex-shrink-0">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-600">Backlog</span>
        <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-1.5">
          {backlogFeatures.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto p-2 space-y-1.5 transition-colors ${
          isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
        }`}
      >
        {isLoading ? (
          <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
        ) : backlogFeatures.length === 0 ? (
          <p className="text-xs text-gray-300 py-6 text-center">
            {isOver ? 'Drop here' : 'Empty'}
          </p>
        ) : (
          backlogFeatures.map((f) => (
            <DraggableBacklogItem key={f.system_id} feature={f} />
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
