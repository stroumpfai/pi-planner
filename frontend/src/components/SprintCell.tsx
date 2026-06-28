import { useDroppable } from '@dnd-kit/core'
import { GroupCard } from './GroupCard'
import type { Group } from '@/types'

interface Props {
  readonly swimlaneId: string
  readonly sprintIndex: number
  readonly groups: Group[]
  readonly projectId: string
  readonly featureId?: string
  readonly featureTitle?: string
}

export function SprintCell({ swimlaneId, sprintIndex, groups, projectId, featureId, featureTitle }: Props) {
  const cellGroups = groups.filter((g) => g.sprint_index === sprintIndex)

  const droppableId = featureId
    ? `sprintcell:${swimlaneId}:${featureId}:${sprintIndex}`
    : `sprintcell:${swimlaneId}:${sprintIndex}`

  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: 'sprintcell', swimlaneId, sprintIndex },
  })

  return (
    <div
      ref={setNodeRef}
      className={`m-1.5 p-2 rounded-xl min-h-16 space-y-2 transition-colors ${
        isOver ? 'bg-blue-50/80 ring-1 ring-blue-200' : ''
      }`}
    >
      {cellGroups.length === 0 && isOver && (
        <p className="text-xs text-blue-400 text-center py-2">Drop group here</p>
      )}
      {cellGroups.map((group) => (
        <GroupCard key={group.system_id} group={group} projectId={projectId} featureTitle={featureTitle} />
      ))}
    </div>
  )
}
