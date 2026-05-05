import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useFeatures } from '@/hooks/useFeatures'
import { FeatureCard } from './FeatureCard'
import { CreateGroupModal } from './CreateGroupModal'

interface Props {
  readonly swimlineId: string
  readonly projectId: string
  readonly piId: string
}

export function FeatureZone({ swimlineId, projectId, piId }: Props) {
  const [pendingGroup, setPendingGroup] = useState<{ featureId: string; pbiIds: string[] } | null>(null)
  const { data: allFeatures, isLoading } = useFeatures(projectId)

  const features = allFeatures?.filter(
    (f) => f.location === 'pi' && f.swimlane_id === swimlineId && f.pi_id === piId
  ) ?? []

  const { setNodeRef, isOver } = useDroppable({
    id: `featurezone:${swimlineId}`,
    data: { type: 'featurezone', swimlaneId: swimlineId, piId },
  })

  if (isLoading) {
    return <div className="p-2 text-xs text-gray-400">Loading…</div>
  }

  return (
    <>
      <div
        ref={setNodeRef}
        className={`min-h-16 p-2 space-y-2 transition-colors ${
          isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
        }`}
      >
        {features.length === 0 ? (
          <p className={`text-xs text-center py-4 ${isOver ? 'text-blue-400' : 'text-gray-300'}`}>
            {isOver ? 'Drop here' : 'Drop features here'}
          </p>
        ) : (
          features.map((f) => (
            <FeatureCard
              key={f.system_id}
              feature={f}
              projectId={projectId}
              onCreateGroup={(featureId, pbiIds) => setPendingGroup({ featureId, pbiIds })}
            />
          ))
        )}
      </div>

      {pendingGroup && (
        <CreateGroupModal
          open
          swimlaneId={swimlineId}
          featureId={pendingGroup.featureId}
          pbiIds={pendingGroup.pbiIds}
          piId={piId}
          onClose={() => setPendingGroup(null)}
        />
      )}
    </>
  )
}
