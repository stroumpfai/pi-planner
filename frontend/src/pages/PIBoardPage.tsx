import { useState } from 'react'
import { useSwimlinesForPI } from '@/hooks/useSwimlinesAndGroups'
import { useSprints } from '@/hooks/useSprints'
import { useFeatures } from '@/hooks/useFeatures'
import { useAuthStore } from '@/stores/authStore'
import { usePIs } from '@/hooks/usePIs'
import { SwimlaneRow } from '@/components/SwimlaneRow'
import { CreateSwimlaneModal } from '@/components/CreateSwimlaneModal'

interface Props {
  readonly projectId: string
  readonly piId: string
}

export function PIBoardPage({ projectId, piId }: Props) {
  const [showCreateSwimline, setShowCreateSwimline] = useState(false)
  const isEditing = useAuthStore((s) => s.isEditing)

  const { data: pis } = usePIs(projectId)
  const { data: swimlines, isLoading: swimlinesLoading } = useSwimlinesForPI(piId)
  const { data: sprints, isLoading: sprintsLoading } = useSprints(piId)
  const { data: features } = useFeatures(projectId)

  const pi = pis?.find((p) => p.system_id === piId)
  const isLoading = swimlinesLoading || sprintsLoading

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Board header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-800">{pi?.name ?? 'PI Board'}</h2>
          {pi?.state && (
            <span className="text-xs text-gray-400 capitalize">{pi.state.replace('_', ' ')}</span>
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

      {/* Column headers (sprint labels) */}
      <div className="flex border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="w-48 flex-shrink-0 border-r border-gray-200 px-3 py-1.5">
          <span className="text-xs font-semibold text-gray-500">Swimlane</span>
        </div>
        <div className="w-48 flex-shrink-0 border-r border-gray-200 px-2 py-1.5">
          <span className="text-xs font-semibold text-gray-500">Features</span>
        </div>
        {sprints?.map((sprint) => (
          <div key={sprint.system_id} className="flex-1 px-2 py-1.5 border-r border-gray-100 last:border-r-0">
            <span className="text-xs font-semibold text-gray-500">Sprint {sprint.sprint_index! + 1}</span>
          </div>
        ))}
      </div>

      {/* Swimlane rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-gray-400 px-4 py-6">Loading board…</p>
        ) : swimlines?.length === 0 ? (
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
        ) : (
          swimlines?.map((swimline) => (
            <SwimlaneRow
              key={swimline.system_id}
              swimline={swimline}
              sprints={sprints ?? []}
              features={features ?? []}
              projectId={projectId}
              piId={piId}
            />
          ))
        )}
      </div>

      <CreateSwimlaneModal
        open={showCreateSwimline}
        piId={piId}
        onClose={() => setShowCreateSwimline(false)}
      />
    </div>
  )
}
