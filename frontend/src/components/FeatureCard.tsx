import { useDraggable } from '@dnd-kit/core'
import { useAuthStore } from '@/stores/authStore'
import { useUpdateFeature } from '@/hooks/useFeatures'
import type { Feature } from '@/types'
import type { FeatureDragData } from './BacklogPanel'

interface Props {
  readonly feature: Feature
  readonly projectId: string
}

export function FeatureCard({ feature, projectId }: Props) {
  const isEditing = useAuthStore((s) => s.isEditing)
  const updateFeature = useUpdateFeature(projectId)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `feature:${feature.system_id}`,
    data: {
      type: 'feature',
      featureId: feature.system_id,
      fromLocation: 'pi',
      fromSwimlaneId: feature.swimlane_id,
    } satisfies FeatureDragData,
  })

  const idPrefix = feature.id == null ? '' : `[${feature.id}] `

  function handleReturnToBacklog() {
    updateFeature.mutate({
      featureId: feature.system_id,
      body: { location: 'backlog' },
    })
  }

  return (
    <div
      ref={setNodeRef}
      className={`bg-white border rounded-md px-3 py-2 shadow-sm space-y-1 transition-opacity select-none ${
        isDragging ? 'opacity-40 border-blue-400' : 'border-gray-200'
      }`}
    >
      <div
        className="flex items-start justify-between gap-2 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <span className="text-sm text-gray-900 leading-snug">
          <span className="text-gray-400 font-mono text-xs">{idPrefix}</span>
          {feature.title}
        </span>
        {feature.effort != null && (
          <span className="flex-shrink-0 text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium">
            {feature.effort}pt
          </span>
        )}
      </div>

      {isEditing && (
        <button
          type="button"
          onClick={handleReturnToBacklog}
          disabled={updateFeature.isPending}
          className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50"
          title="Return to backlog"
        >
          ← Backlog
        </button>
      )}
    </div>
  )
}
