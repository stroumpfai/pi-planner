import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { useSwimlinesForPI, useReorderSwimlines } from '@/hooks/useSwimlinesAndGroups'
import { groupsApi } from '@/services/groups'
import { pbisApi } from '@/services/pbis'
import { useSprints } from '@/hooks/useSprints'
import { useFeatures, useUpdateFeature } from '@/hooks/useFeatures'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSwimlaneCollapseStore } from '@/stores/swimlaneCollapseStore'
import { usePIs } from '@/hooks/usePIs'
import { useEffortUnit } from '@/hooks/useProjects'
import { useMaxTextWidth } from '@/hooks/useMaxTextWidth'
import { SwimlaneRow } from '@/components/SwimlaneRow'
import { CreateSwimlaneModal } from '@/components/CreateSwimlaneModal'
import { SprintCapacityModal } from '@/components/SprintCapacityModal'
import { SprintColumnHeader } from '@/components/SprintColumnHeader'
import { CapacityBar } from '@/components/CapacityBar'
import { BacklogPanel } from '@/components/BacklogPanel'
import type { FeatureDragData } from '@/components/BacklogPanel'
import type { GroupDragData } from '@/components/GroupCard'
import type { PBIDragData } from '@/components/PBIRow'
import type { Feature, Sprint, Swimline } from '@/types'

interface Props {
  readonly projectId: string
  readonly piId: string
}

interface ActiveDrag {
  type: 'feature' | 'swimlane' | 'group' | 'pbi'
  label: string
}

type OverData = { type?: string; swimlaneId?: string; piId?: string; sprintIndex?: number }

const SWIMLANE_TITLE_MAX_WIDTH = 220

function getFeatureLabel(feature: Feature): string {
  const prefix = feature.id == null ? '' : `[${feature.id}] `
  return `${prefix}${feature.title}`
}

function applyFeatureDrop(
  activeData: FeatureDragData,
  overData: OverData | undefined,
  onMoveToSwimlane: (swimlaneId: string) => void,
  onReturnToBacklog: () => void,
): void {
  if (overData?.type === 'featurezone') {
    const targetId = overData.swimlaneId
    if (targetId && targetId !== activeData.fromSwimlaneId) {
      onMoveToSwimlane(targetId)
    }
  } else if (overData?.type === 'backlog' && activeData.fromLocation !== 'backlog') {
    onReturnToBacklog()
  }
}

function applySwimlaneReorder(
  activeId: string,
  overId: string,
  swimlines: Swimline[],
  onReorder: (swimlineId: string, order: string[]) => void,
): void {
  if (activeId === overId) return
  const oldIndex = swimlines.findIndex((s) => `swimlane:${s.system_id}` === activeId)
  const newIndex = swimlines.findIndex((s) => `swimlane:${s.system_id}` === overId)
  if (oldIndex === -1 || newIndex === -1) return
  const reordered = arrayMove(swimlines, oldIndex, newIndex)
  onReorder(swimlines[oldIndex].system_id, reordered.map((s) => s.system_id))
}

function PIStateBadgeInline({ state }: { readonly state: string }) {
  if (state === 'closed') return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
      Closed · Read-only
    </span>
  )
  if (state === 'in_progress') return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 capitalize">
      In progress
    </span>
  )
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 capitalize">
      {state}
    </span>
  )
}

function ResizeHandle({ onResize, currentWidth }: { readonly onResize: (w: number) => void; readonly currentWidth: number }) {
  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = currentWidth
    function onMove(ev: MouseEvent) {
      const next = Math.min(480, Math.max(120, startWidth + ev.clientX - startX))
      onResize(next)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') onResize(Math.min(480, currentWidth + 8))
    else if (e.key === 'ArrowLeft') onResize(Math.max(120, currentWidth - 8))
  }
  return (
    <button
      type="button"
      aria-label="Resize feature column"
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-300 transition-colors focus:outline-none focus:bg-blue-300 p-0 border-0 bg-transparent"
    />
  )
}

export function PIBoardPage({ projectId, piId }: Props) {
  const [showCreateSwimline, setShowCreateSwimline] = useState(false)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const [editCapacitySprint, setEditCapacitySprint] = useState<Sprint | null>(null)
  const isEditing = useAuthStore((s) => s.isEditing)
  const featureColumnWidth = useSettingsStore((s) => s.featureColumnWidth)
  const setFeatureColumnWidth = useSettingsStore((s) => s.setFeatureColumnWidth)

  const { data: pis } = usePIs(projectId)
  const { data: swimlines } = useSwimlinesForPI(piId)
  const { data: sprints, isLoading: sprintsLoading } = useSprints(piId)
  const { data: features } = useFeatures(projectId)

  const updateFeature = useUpdateFeature(projectId)
  const reorderSwimlines = useReorderSwimlines(piId)
  const qc = useQueryClient()

  const pi = pis?.find((p) => p.system_id === piId)
  const isClosedPI = pi?.state === 'closed'
  const canEdit = isEditing && !isClosedPI
  const effortUnit = useEffortUnit(projectId)
  const swimlineIds = swimlines?.map((s) => `swimlane:${s.system_id}`) ?? []
  const swimlaneSystemIds = useMemo(() => swimlines?.map((s) => s.system_id) ?? [], [swimlines])
  const setAllSwimlanesCollapsed = useSwimlaneCollapseStore((s) => s.setAll)
  const swimlaneNames = useMemo(() => swimlines?.map((s) => s.name) ?? [], [swimlines])
  const swimlaneTitleWidth = useMaxTextWidth(swimlaneNames, 'text-sm font-semibold', SWIMLANE_TITLE_MAX_WIDTH)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart({ active }: DragStartEvent) {
    const data = active.data.current
    if (data?.type === 'feature') {
      const feature = features?.find((f) => f.system_id === data.featureId)
      setActiveDrag({ type: 'feature', label: feature ? getFeatureLabel(feature) : 'Feature' })
    } else if (data?.type === 'swimlane') {
      const swimlane = swimlines?.find((s) => s.system_id === data.swimlaneId)
      setActiveDrag({ type: 'swimlane', label: swimlane?.name ?? 'Swimlane' })
    } else if (data?.type === 'group') {
      setActiveDrag({ type: 'group', label: data.groupId ?? 'Group' })
    } else if (data?.type === 'pbi') {
      setActiveDrag({ type: 'pbi', label: (data as PBIDragData).pbiLabel })
    }
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDrag(null)
    if (!over || !canEdit) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeData = active.data.current as Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overData = over.data.current as Record<string, any> | undefined

    if (activeData.type === 'feature') {
      applyFeatureDrop(
        activeData as FeatureDragData,
        overData,
        (swimlaneId) => updateFeature.mutate({ featureId: (activeData as FeatureDragData).featureId, body: { swimlane_id: swimlaneId } }),
        () => updateFeature.mutate({ featureId: (activeData as FeatureDragData).featureId, body: { location: 'backlog' } }),
      )
      return
    }

    if (activeData.type === 'pbi' && overData?.type === 'sprintcell') {
      const pd = activeData as PBIDragData
      if (overData.swimlaneId !== pd.swimlaneId) return
      pbisApi
        .place(pd.pbiId, { sprint_index: overData.sprintIndex ?? 0 })
        .then(() => {
          void qc.invalidateQueries({ queryKey: ['groups', pd.swimlaneId] })
          void qc.invalidateQueries({ queryKey: ['pbis', projectId] })
        })
        .catch(() => {/* error reflected on next refetch */})
      return
    }

    if (activeData.type === 'group' && overData?.type === 'sprintcell') {
      const gd = activeData as GroupDragData
      if (overData.sprintIndex !== gd.fromSprintIndex) {
        groupsApi
          .update(gd.groupId, { sprint_index: overData.sprintIndex ?? null })
          .then(() => qc.invalidateQueries({ queryKey: ['groups', gd.swimlaneId] }))
          .catch(() => {/* error handled by React Query on next refetch */})
      }
      return
    }

    if (activeData.type === 'swimlane' && overData?.type === 'swimlane' && swimlines) {
      applySwimlaneReorder(
        active.id.toString(),
        over.id.toString(),
        swimlines,
        (swimlineId, order) => reorderSwimlines.mutate({ swimlineId, order }),
      )
    }
  }

  function renderBoardContent() {
    if (sprintsLoading) {
      return <p className="text-sm text-gray-400 px-4 py-6">Loading board…</p>
    }
    if (!swimlines?.length) {
      return (
        <div className="flex flex-col items-center justify-center h-48 gap-2">
          <p className="text-sm text-gray-400">No swimlanes yet</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowCreateSwimline(true)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add first swimlane
            </button>
          )}
        </div>
      )
    }
    return (
      <SortableContext items={swimlineIds} strategy={verticalListSortingStrategy}>
        {swimlines.map((swimline) => (
          <SwimlaneRow
            key={swimline.system_id}
            swimline={swimline}
            sprints={sprints ?? []}
            features={features ?? []}
            projectId={projectId}
            piId={piId}
          />
        ))}
      </SortableContext>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full overflow-hidden">
        <BacklogPanel projectId={projectId} />

        <div
          className="flex flex-col flex-1 overflow-hidden"
          style={{
            '--feature-col-width': `${featureColumnWidth}px`,
            '--swimlane-title-width': `${swimlaneTitleWidth}px`,
          } as React.CSSProperties}
        >
          {/* Board header: name + PI capacity summary + Add Swimlane */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0 gap-4">
            <div className="flex items-center gap-2 flex-shrink-0">
              <h2 className="text-sm font-semibold text-gray-800">{pi?.name ?? 'PI Board'}</h2>
              {pi?.state && <PIStateBadgeInline state={pi.state} />}
            </div>
            {pi && (
              <div className="flex-1 max-w-xs">
                <CapacityBar used={pi.total_effort ?? 0} capacity={pi.total_capacity ?? 0} unit={effortUnit} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setAllSwimlanesCollapsed(piId, swimlaneSystemIds, true)}
              disabled={!swimlaneSystemIds.length}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed font-medium flex-shrink-0"
            >
              Collapse All
            </button>
            <button
              type="button"
              onClick={() => setAllSwimlanesCollapsed(piId, swimlaneSystemIds, false)}
              disabled={!swimlaneSystemIds.length}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed font-medium flex-shrink-0"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={() => setShowCreateSwimline(true)}
              disabled={!canEdit}
              title={canEdit ? undefined : 'Request Edit Mode to add swimlanes'}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed font-medium flex-shrink-0"
            >
              + Add Swimlane
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Column headers: sticky so they stay visible while swimlanes scroll */}
            <div className="sticky top-0 z-10 flex border-b border-gray-200 bg-gray-50 flex-shrink-0">
              <div
                className="flex-shrink-0 border-r border-gray-200 px-3 py-1.5 relative"
                style={{ width: 'var(--feature-col-width, 192px)' }}
              >
                <span className="text-xs font-semibold text-gray-500">Swimlane / Features</span>
                <ResizeHandle onResize={setFeatureColumnWidth} currentWidth={featureColumnWidth} />
              </div>
              {sprints?.map((sprint) => (
                <div key={sprint.system_id} className="flex-1 border-r border-gray-100 last:border-r-0">
                  <SprintColumnHeader
                    sprint={sprint}
                    usedEffort={sprint.effort ?? 0}
                    unit={effortUnit}
                    onEditCapacity={canEdit ? () => setEditCapacitySprint(sprint) : undefined}
                  />
                </div>
              ))}
            </div>

            {renderBoardContent()}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag?.type === 'feature' && (
          <div className="bg-white border border-blue-400 rounded-md px-3 py-2 shadow-lg text-sm text-gray-800 max-w-40 truncate cursor-grabbing">
            {activeDrag.label}
          </div>
        )}
        {activeDrag?.type === 'group' && (
          <div className="bg-white border border-blue-400 rounded-md px-3 py-2 shadow-lg text-xs font-semibold text-gray-800 cursor-grabbing">
            {activeDrag.label}
          </div>
        )}
        {activeDrag?.type === 'pbi' && (
          <div className="bg-white border border-blue-400 rounded px-3 py-2 shadow-lg text-xs text-gray-700 cursor-grabbing">
            {activeDrag.label}
          </div>
        )}
        {activeDrag?.type === 'swimlane' && (
          <div className="bg-gray-100 border border-blue-400 rounded px-3 py-2 shadow-lg text-sm font-semibold text-gray-800 cursor-grabbing">
            {activeDrag.label}
          </div>
        )}
      </DragOverlay>

      <CreateSwimlaneModal
        open={showCreateSwimline}
        piId={piId}
        onClose={() => setShowCreateSwimline(false)}
      />

      {editCapacitySprint && (
        <SprintCapacityModal
          open
          sprint={editCapacitySprint}
          piId={piId}
          onClose={() => setEditCapacitySprint(null)}
        />
      )}
    </DndContext>
  )
}
