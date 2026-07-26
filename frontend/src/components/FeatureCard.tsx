import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useAuthStore } from '@/stores/authStore'
import { useCancelContinuation, useFeatures, useUpdateFeature } from '@/hooks/useFeatures'
import { usePIs } from '@/hooks/usePIs'
import { usePBIs } from '@/hooks/usePBIs'
import { useEffortUnit } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { toast } from '@/stores/toastStore'
import { PBISelectList } from './PBISelectList'
import { SplitFeatureModal } from './SplitFeatureModal'
import { WorkItemLink } from './WorkItemLink'
import { ConfirmDialog } from './ConfirmDialog'
import { getFeatureColorIdx, lineageRootId, FEATURE_BORDER_COLORS } from '@/utils/featureColors'
import type { Feature } from '@/types'
import type { FeatureDragData } from './BacklogPanel'

interface Props {
  readonly feature: Feature
  readonly projectId: string
  readonly onCreateGroup?: (featureId: string, pbiIds: string[]) => void
}

// Every PI the whole continuation lineage spans (all transitive predecessors and
// successors, not just the direct neighbours), minus the PI currently being viewed,
// in chronological order (oldest predecessor first, successors last).
function lineagePIs(feature: Feature, allFeatures: readonly Feature[]): string[] {
  const byId = new Map(allFeatures.map((f) => [f.system_id, f]))
  const ancestors: Feature[] = []
  for (
    let cur = feature.continued_from_feature_id ? byId.get(feature.continued_from_feature_id) : undefined;
    cur && !ancestors.includes(cur);
    cur = cur.continued_from_feature_id ? byId.get(cur.continued_from_feature_id) : undefined
  ) {
    ancestors.push(cur)
  }
  ancestors.reverse()

  const descendants: Feature[] = []
  const queue = allFeatures.filter((f) => f.continued_from_feature_id === feature.system_id)
  while (queue.length > 0) {
    const node = queue.shift()!
    if (descendants.some((d) => d.system_id === node.system_id)) continue
    descendants.push(node)
    queue.push(...allFeatures.filter((f) => f.continued_from_feature_id === node.system_id))
  }

  const relatedPIs: string[] = []
  const seen = new Set<string>(feature.pi_id ? [feature.pi_id] : [])
  for (const f of [...ancestors, ...descendants]) {
    if (f.pi_id && !seen.has(f.pi_id)) {
      seen.add(f.pi_id)
      relatedPIs.push(f.pi_id)
    }
  }
  return relatedPIs
}

export function FeatureCard({ feature, projectId, onCreateGroup }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [selectedPbiIds, setSelectedPbiIds] = useState<Set<string>>(new Set())
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const isEditing = useAuthStore((s) => s.isEditing)
  const effortUnit = useEffortUnit(projectId)
  const showIds = useSettingsStore((s) => s.showIds)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const setActivePI = useUiStore((s) => s.setActivePI)
  const updateFeature = useUpdateFeature(projectId)
  const cancelContinuation = useCancelContinuation(projectId)
  const { data: featurePbis = [] } = usePBIs(projectId, feature.system_id)
  const { data: allFeatures = [] } = useFeatures(projectId)
  const { data: pis = [] } = usePIs(projectId)
  const isFullyPlanned = featurePbis.length > 0 && featurePbis.every((p) => p.group_id != null)
  const featureById = new Map(allFeatures.map((f) => [f.system_id, f]))
  const borderColor = FEATURE_BORDER_COLORS[getFeatureColorIdx(lineageRootId(feature.system_id, featureById))]

  const continuedFrom = allFeatures.find((f) => f.system_id === feature.continued_from_feature_id)
  const continuations = allFeatures.filter((f) => f.continued_from_feature_id === feature.system_id)
  const piName = (piId: string | null) => pis.find((p) => p.system_id === piId)?.name ?? 'another PI'
  const relatedPIs = lineagePIs(feature, allFeatures)
  // A continuation can be cancelled only when it is a leaf (not split further downstream).
  const canCancelContinuation = isEditing && !!continuedFrom && continuations.length === 0

  function handleCancelContinuation() {
    setCancelConfirmOpen(false)
    cancelContinuation.mutate(feature.system_id, {
      onSuccess: () => toast.success('Continuation cancelled'),
      onError: () => toast.error('Failed to cancel continuation'),
    })
  }

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
      className={`group bg-canvas rounded-xl2 shadow-soft transition-shadow select-none ${
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
        <WorkItemLink projectId={projectId} id={feature.id} />
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

      {/* Continuation lineage — this feature's work also lives in these PIs */}
      {relatedPIs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1 px-3 pb-1 text-xs text-gray-400 dark:text-gray-500">
          <span>⟲ also in</span>
          {relatedPIs.map((piId, idx) => (
            <span key={piId} className="flex items-center gap-x-1">
              {idx > 0 && <span aria-hidden>/</span>}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setActivePI(piId) }}
                title={`Jump to ${piName(piId)}`}
                className="hover:text-blue-500 hover:underline"
              >
                {piName(piId)}
              </button>
            </span>
          ))}
          {canCancelContinuation && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCancelConfirmOpen(true) }}
              disabled={cancelContinuation.isPending}
              title="Move these PBIs back to the origin feature and remove this continuation"
              className="ml-1 hover:text-red-500 hover:underline disabled:cursor-not-allowed"
            >
              ✕ cancel
            </button>
          )}
        </div>
      )}

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
          {isEditing && selectedPbiIds.size > 0 && feature.location === 'pi' && (
            <button
              type="button"
              onClick={() => setSplitModalOpen(true)}
              className="w-full mt-1 text-xs border border-blue-400 text-blue-600 rounded px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/30"
            >
              → Move {selectedPbiIds.size} PBI{selectedPbiIds.size === 1 ? '' : 's'} to PI
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

      <SplitFeatureModal
        open={splitModalOpen}
        projectId={projectId}
        featureId={feature.system_id}
        currentPiId={feature.pi_id}
        pbiIds={Array.from(selectedPbiIds)}
        onClose={() => {
          setSplitModalOpen(false)
          setSelectedPbiIds(new Set())
          setExpanded(false)
        }}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel continuation?"
        description={`The PBIs carried into ${piName(feature.pi_id)} will move back to the origin feature in ${piName(continuedFrom?.pi_id ?? null)} (unsprinted), and this continuation will be removed.`}
        confirmLabel="Cancel continuation"
        destructive
        onConfirm={handleCancelContinuation}
        onCancel={() => setCancelConfirmOpen(false)}
      />
    </div>
  )
}
