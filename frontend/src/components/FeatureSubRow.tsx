import { useState } from 'react'
import { FeatureCard } from './FeatureCard'
import { SprintCell } from './SprintCell'
import { CreateGroupModal } from './CreateGroupModal'
import type { Feature, Group, Sprint } from '@/types'

interface Props {
  readonly feature: Feature
  readonly sprints: Sprint[]
  readonly groups: Group[]
  readonly projectId: string
  readonly swimlaneId: string
}

export function FeatureSubRow({ feature, sprints, groups, projectId, swimlaneId }: Props) {
  const [pendingGroup, setPendingGroup] = useState<{ featureId: string; pbiIds: string[] } | null>(null)

  return (
    <>
      <div className="flex border-b border-gray-100 min-h-16">
        <div
          className="flex-shrink-0 border-r border-gray-200 p-2"
          style={{ width: 'var(--feature-col-width, 192px)' }}
        >
          <FeatureCard
            feature={feature}
            projectId={projectId}
            onCreateGroup={(featureId, pbiIds) => setPendingGroup({ featureId, pbiIds })}
          />
        </div>

        {sprints.map((sprint) => (
          <div key={sprint.system_id} className="flex-1 border-r border-gray-100 last:border-r-0">
            <SprintCell
              swimlaneId={swimlaneId}
              sprintIndex={sprint.sprint_index ?? 0}
              groups={groups}
              projectId={projectId}
              featureId={feature.system_id}
            />
          </div>
        ))}
      </div>

      {pendingGroup && (
        <CreateGroupModal
          open
          swimlaneId={swimlaneId}
          featureId={pendingGroup.featureId}
          pbiIds={pendingGroup.pbiIds}
          onClose={() => setPendingGroup(null)}
        />
      )}
    </>
  )
}
