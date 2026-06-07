import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuthStore } from '@/stores/authStore'
import { useSwimlaneCollapseStore } from '@/stores/swimlaneCollapseStore'
import { useDeleteSwimline, useUpdateSwimline, useGroupsForSwimline } from '@/hooks/useSwimlinesAndGroups'
import { useEffortUnit } from '@/hooks/useProjects'
import { CapacityBar } from './CapacityBar'
import { ConfirmDialog } from './ConfirmDialog'
import { FeatureZone } from './FeatureZone'
import { SprintCell } from './SprintCell'
import type { Feature, Sprint, Swimline } from '@/types'

interface Props {
  readonly swimline: Swimline
  readonly sprints: Sprint[]
  readonly features: Feature[]
  readonly projectId: string
  readonly piId: string
}

export function SwimlaneRow({ swimline, sprints, features, projectId, piId }: Props) {
  const collapsed = useSwimlaneCollapseStore((s) => s.isCollapsed(piId, swimline.system_id))
  const toggleCollapsed = useSwimlaneCollapseStore((s) => s.toggle)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const isEditing = useAuthStore((s) => s.isEditing)
  const effortUnit = useEffortUnit(projectId)
  const deleteSwimline = useDeleteSwimline(piId)
  const updateSwimline = useUpdateSwimline(piId)

  function handleRenameSubmit() {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === swimline.name) {
      setRenaming(false)
      setRenameError(null)
      return
    }
    if (updateSwimline.isPending) return
    updateSwimline.mutate(
      { swimlineId: swimline.system_id, body: { name: trimmed } },
      {
        onSuccess: () => { setRenaming(false); setRenameError(null) },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { detail?: { message?: string } } } })
            ?.response?.data?.detail?.message ?? 'Could not rename swimlane'
          setRenameError(msg)
        },
      }
    )
  }
  const { data: groups = [] } = useGroupsForSwimline(swimline.system_id)

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

  const style = { transform: CSS.Transform.toString(transform), transition }

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
          onClick={() => toggleCollapsed(piId, swimline.system_id)}
          className="text-gray-500 hover:text-gray-700 text-xs w-4"
          aria-label={collapsed ? 'Expand swimlane' : 'Collapse swimlane'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        {renaming ? (
          <div className="flex flex-col min-w-0">
            <input
              autoFocus
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setRenameError(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { handleRenameSubmit() }
                else if (e.key === 'Escape') { setRenaming(false); setRenameError(null) }
              }}
              onBlur={handleRenameSubmit}
              className="text-sm font-semibold border border-blue-300 rounded px-1 py-0.5 bg-white focus:outline-none"
            />
            {renameError && (
              <span className="text-xs text-red-500 mt-0.5">{renameError}</span>
            )}
          </div>
        ) : (
          <span
            className="text-sm font-semibold text-gray-800 truncate"
            style={{ width: 'var(--swimlane-title-width, auto)' }}
            title={swimline.name}
          >
            {swimline.name}
          </span>
        )}
        <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">
          {featureCount}
        </span>
        <div className="flex-1 max-w-28">
          <CapacityBar used={swimline.effort} capacity={swimline.capacity} unit={effortUnit} />
        </div>
        {isEditing && (
          <>
            {!renaming && (
              <button
                type="button"
                onClick={() => { setNewName(swimline.name); setRenameError(null); setRenaming(true) }}
                className="text-xs text-gray-400 hover:text-blue-600"
                title="Rename swimlane"
              >✎</button>
            )}
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-xs text-red-400 hover:text-red-600 ml-1"
              title="Delete swimlane"
            >✕</button>
          </>
        )}
      </div>

      {/* Grid: feature zone + sprint columns */}
      {!collapsed && (
        <div className="flex min-h-24">
          <div
            className="flex-shrink-0 border-r border-gray-200"
            style={{ width: 'var(--feature-col-width, 192px)' }}
          >
            <div className="text-xs text-gray-400 px-2 pt-1 pb-0.5 bg-gray-50 border-b border-gray-100">
              Features
            </div>
            <FeatureZone swimlineId={swimline.system_id} projectId={projectId} piId={piId} />
          </div>

          {sprints.map((sprint) => (
            <div key={sprint.system_id} className="flex-1 border-r border-gray-100 last:border-r-0">
              <SprintCell
                swimlaneId={swimline.system_id}
                sprintIndex={sprint.sprint_index ?? 0}
                groups={groups}
                projectId={projectId}
              />
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
