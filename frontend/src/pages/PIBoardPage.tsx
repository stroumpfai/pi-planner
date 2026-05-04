import { useState } from 'react'
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
import { useSwimlinesForPI, useReorderSwimlines } from '@/hooks/useSwimlinesAndGroups'
import { useSprints } from '@/hooks/useSprints'
import { useFeatures, useUpdateFeature } from '@/hooks/useFeatures'
import { useAuthStore } from '@/stores/authStore'
import { usePIs } from '@/hooks/usePIs'
import { SwimlaneRow } from '@/components/SwimlaneRow'
import { CreateSwimlaneModal } from '@/components/CreateSwimlaneModal'
import { BacklogPanel } from '@/components/BacklogPanel'
import type { FeatureDragData } from '@/components/BacklogPanel'
import type { Feature, Swimline } from '@/types'

interface Props {
  readonly projectId: string
  readonly piId: string
}

interface ActiveDrag {
  type: 'feature' | 'swimlane'
  label: string
}

type OverData = { type: string; swimlaneId?: string; piId?: string }

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

export function PIBoardPage({ projectId, piId }: Props) {
  const [showCreateSwimline, setShowCreateSwimline] = useState(false)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const isEditing = useAuthStore((s) => s.isEditing)

  const { data: pis } = usePIs(projectId)
  const { data: swimlines } = useSwimlinesForPI(piId)
  const { data: sprints, isLoading: sprintsLoading } = useSprints(piId)
  const { data: features } = useFeatures(projectId)

  const updateFeature = useUpdateFeature(projectId)
  const reorderSwimlines = useReorderSwimlines(piId)

  const pi = pis?.find((p) => p.system_id === piId)
  const swimlineIds = swimlines?.map((s) => `swimlane:${s.system_id}`) ?? []

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
    }
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDrag(null)
    if (!over) return

    const activeData = active.data.current as FeatureDragData & { type: string }
    const overData = over.data.current as OverData | undefined

    if (activeData.type === 'feature') {
      applyFeatureDrop(
        activeData,
        overData,
        (swimlaneId) => updateFeature.mutate({ featureId: activeData.featureId, body: { swimlane_id: swimlaneId } }),
        () => updateFeature.mutate({ featureId: activeData.featureId, body: { location: 'backlog' } }),
      )
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
          {isEditing && (
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
        {/* Backlog panel — droppable zone + draggable feature items */}
        <BacklogPanel projectId={projectId} />

        {/* Board section */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Board header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-800">{pi?.name ?? 'PI Board'}</h2>
              {pi?.state && (
                <span className="text-xs text-gray-400 capitalize">
                  {pi.state.replace('_', ' ')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowCreateSwimline(true)}
              disabled={!isEditing}
              title={isEditing ? undefined : 'Request Edit Mode to add swimlanes'}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed font-medium"
            >
              + Add Swimlane
            </button>
          </div>

          {/* Column headers */}
          <div className="flex border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="w-48 flex-shrink-0 border-r border-gray-200 px-3 py-1.5">
              <span className="text-xs font-semibold text-gray-500">Swimlane / Features</span>
            </div>
            {sprints?.map((sprint) => (
              <div
                key={sprint.system_id}
                className="flex-1 px-2 py-1.5 border-r border-gray-100 last:border-r-0"
              >
                <span className="text-xs font-semibold text-gray-500">
                  Sprint {(sprint.sprint_index ?? 0) + 1}
                </span>
              </div>
            ))}
          </div>

          {/* Swimlane rows */}
          <div className="flex-1 overflow-y-auto">{renderBoardContent()}</div>
        </div>
      </div>

      {/* Drag overlay — ghost preview under cursor */}
      <DragOverlay dropAnimation={null}>
        {activeDrag?.type === 'feature' && (
          <div className="bg-white border border-blue-400 rounded-md px-3 py-2 shadow-lg text-sm text-gray-800 max-w-40 truncate cursor-grabbing">
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
    </DndContext>
  )
}
