import { useDroppable } from '@dnd-kit/core'
import { GroupCard } from './GroupCard'
import type { Group } from '@/types'

interface Props {
  readonly swimlaneId: string
  readonly sprintIndex: number
  readonly groups: Group[]
  readonly projectId: string
}

export function SprintCell({ swimlaneId, sprintIndex, groups, projectId }: Props) {
  const cellGroups = groups.filter((g) => g.sprint_index === sprintIndex)

  const { setNodeRef, isOver } = useDroppable({
    id: `sprintcell:${swimlaneId}:${sprintIndex}`,
    data: { type: 'sprintcell', swimlaneId, sprintIndex },
  })

  return (
    <div
      ref={setNodeRef}
      className={`p-2 min-h-16 space-y-2 transition-colors ${
        isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
      }`}
    >
      {cellGroups.length === 0 && isOver && (
        <p className="text-xs text-blue-400 text-center py-2">Drop group here</p>
      )}
      {cellGroups.map((group) => (
        <GroupCard key={group.system_id} group={group} projectId={projectId} />
      ))}
    </div>
  )
}
