import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuthStore } from '@/stores/authStore'
import { useDeleteSwimline } from '@/hooks/useSwimlinesAndGroups'
import { ConfirmDialog } from './ConfirmDialog'
import { FeatureZone } from './FeatureZone'
import { SprintColumnHeader } from './SprintColumnHeader'
import type { Feature, Sprint, Swimline } from '@/types'

interface Props {
  readonly swimline: Swimline
  readonly sprints: Sprint[]
  readonly features: Feature[]
  readonly projectId: string
  readonly piId: string
}

// Sprint-level effort tracking is wired in M7 (group→sprint assignment).
function usedEffortForSprint(_features: Feature[], _sprintIndex: number): number {
  return 0
}

export function SwimlaneRow({ swimline, sprints, features, projectId, piId }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const isEditing = useAuthStore((s) => s.isEditing)
  const deleteSwimline = useDeleteSwimline(piId)

  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `swimlane:${swimline.system_id}`,
    data: { type: 'swimlane', swimlaneId: swimline.system_id },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const featureCount = features.filter(
    (f) => f.location === 'pi' && f.swimlane_id === swimline.system_id && f.pi_id === piId
  ).length

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border-b border-gray-200 ${isDragging ? 'opacity-50 z-10 shadow-lg' : ''}`}
    >
      {/* Swimlane header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border-b border-gray-200">
        {/* Drag handle — only shown in edit mode */}
        {isEditing && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing px-0.5"
            aria-label="Drag to reorder swimlane"
            title="Drag to reorder"
          >
            ⠿
          </button>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-gray-500 hover:text-gray-700 text-xs w-4"
          aria-label={collapsed ? 'Expand swimlane' : 'Collapse swimlane'}
        >
          {collapsed ? '▶' : '▼'}
        </button>

        <span className="text-sm font-semibold text-gray-800 flex-1">{swimline.name}</span>

        <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">
          {featureCount}
        </span>

        {isEditing && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="text-xs text-red-400 hover:text-red-600 ml-1"
            title="Delete swimlane"
          >
            ✕
          </button>
        )}
      </div>

      {/* Grid: feature zone + sprint columns */}
      {!collapsed && (
        <div className="flex min-h-24">
          {/* Feature zone — fixed left column */}
          <div className="w-48 flex-shrink-0 border-r border-gray-200">
            <div className="text-xs text-gray-400 px-2 pt-1 pb-0.5 bg-gray-50 border-b border-gray-100">
              Features
            </div>
            <FeatureZone swimlineId={swimline.system_id} projectId={projectId} piId={piId} />
          </div>

          {/* Sprint columns */}
          {sprints.map((sprint) => (
            <div key={sprint.system_id} className="flex-1 border-r border-gray-100 last:border-r-0">
              <SprintColumnHeader
                sprint={sprint}
                usedEffort={usedEffortForSprint(features, sprint.sprint_index ?? 0)}
              />
              {/* Sprint cells — group cards go here in M7 */}
              <div className="p-2 min-h-16" />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Swimlane"
        description={`"${swimline.name}" and all its groups will be deleted. Features will return to the backlog.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          deleteSwimline.mutate(swimline.system_id)
          setShowDeleteConfirm(false)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
