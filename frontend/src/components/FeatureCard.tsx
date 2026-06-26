import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useAuthStore } from '@/stores/authStore'
import { useUpdateFeature } from '@/hooks/useFeatures'
import { usePBIs } from '@/hooks/usePBIs'
import { useEffortUnit } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'
import { PBISelectList } from './PBISelectList'
import { getFeatureColorIdx, FEATURE_BORDER_COLORS } from '@/utils/featureColors'
import type { Feature } from '@/types'
import type { FeatureDragData } from './BacklogPanel'

interface Props {
  readonly feature: Feature
  readonly projectId: string
  readonly onCreateGroup?: (featureId: string, pbiIds: string[]) => void
}

export function FeatureCard({ feature, projectId, onCreateGroup }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [selectedPbiIds, setSelectedPbiIds] = useState<Set<string>>(new Set())
  const isEditing = useAuthStore((s) => s.isEditing)
  const effortUnit = useEffortUnit(projectId)
  const showIds = useSettingsStore((s) => s.showIds)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const updateFeature = useUpdateFeature(projectId)
  const { data: featurePbis = [] } = usePBIs(projectId, feature.system_id)
  const isFullyPlanned = featurePbis.length > 0 && featurePbis.every((p) => p.group_id != null)
  const borderColor = FEATURE_BORDER_COLORS[getFeatureColorIdx(feature.system_id)]

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `feature:${feature.system_id}`,
    data: {
      type: 'feature',
      featureId: feature.system_id,
      fromLocation: 'pi',
      fromSwimlaneId: feature.swimlane_id,
    } satisfies FeatureDragData,
  })

  const idPrefix = showIds && feature.id != null ? `[${feature.id}] ` : ''

  function handleReturnToBacklog() {
    updateFeature.mutate({ featureId: feature.system_id, body: { location: 'backlog' } })
  }

  function togglePbi(pbiId: string) {
    setSelectedPbiIds((prev) => {
      const next = new Set(prev)
      if (next.has(pbiId)) {
        next.delete(pbiId)
      } else {
        next.add(pbiId)
      }
      return next
    })
  }

  function handleCreateGroup() {
    onCreateGroup?.(feature.system_id, Array.from(selectedPbiIds))
    setSelectedPbiIds(new Set())
    setExpanded(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`bg-canvas rounded-xl2 shadow-soft transition-shadow select-none ${
        isDragging ? 'opacity-40 border border-blue-400' : `border-l-4 ${borderColor}`
      }`}
    >
      {/* Card header — drag handle */}
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <span
          className="text-sm text-gray-900 dark:text-gray-100 leading-snug flex-1 min-w-0 line-clamp-2"
          title={feature.title}
        >
          <span className="text-gray-400 dark:text-gray-500 font-mono text-xs">{idPrefix}</span>
          {feature.title}
        </span>
        {feature.effort != null && (
          <span className="flex-shrink-0 text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full shadow-soft-sm px-1.5 py-0.5 font-medium">
            {feature.effort}{showEffortUnit ? effortUnit : ''}
          </span>
        )}
        {isFullyPlanned && (
          <span
            className="flex-shrink-0 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full shadow-soft-sm px-1.5 py-0.5 font-medium"
            title="All PBIs assigned to sprints"
          >
            ✓
          </span>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500"
          title={expanded ? 'Hide PBIs' : 'Select PBIs to group'}
        >
          {expanded ? '▾ PBIs' : '▸ PBIs'}
        </button>

        <button
          type="button"
          onClick={handleReturnToBacklog}
          disabled={!isEditing || updateFeature.isPending}
          title={isEditing ? 'Return to backlog' : 'Request Edit Mode to move features'}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 disabled:text-gray-200 dark:disabled:text-gray-700 disabled:cursor-not-allowed ml-auto"
        >
          ← Backlog
        </button>
      </div>

      {/* PBI selection panel */}
      {expanded && (
        <div className="border-t border-white/60 px-2 py-1.5 space-y-1">
          <PBISelectList
            featureId={feature.system_id}
            projectId={projectId}
            selectedIds={selectedPbiIds}
            onToggle={togglePbi}
            swimlaneId={feature.swimlane_id ?? ''}
            canDragToSprint={feature.location === 'pi' && !!feature.swimlane_id && isEditing}
          />
          {isEditing && selectedPbiIds.size > 0 && (
            <button
              type="button"
              onClick={handleCreateGroup}
              className="w-full mt-1 text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700"
            >
              + Group {selectedPbiIds.size} PBI{selectedPbiIds.size === 1 ? '' : 's'}
            </button>
          )}
          {isEditing && selectedPbiIds.size === 0 && (
            <button
              type="button"
              onClick={() => onCreateGroup?.(feature.system_id, [])}
              className="w-full mt-1 text-xs border border-blue-400 text-blue-600 rounded px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/30"
            >
              + New Group (empty)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
