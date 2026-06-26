import { useState } from 'react'
import { usePBIs, useCreatePBI } from '@/hooks/usePBIs'
import { useAuthStore } from '@/stores/authStore'
import { PBIRow } from './PBIRow'
import { PBIFormModal } from './PBIFormModal'
import type { PBICreate } from '@/types'

interface Props {
  readonly featureId: string
  readonly projectId: string
}

export function PBIList({ featureId, projectId }: Props) {
  const [createType, setCreateType] = useState<'story' | 'bug' | null>(null)
  const isEditing = useAuthStore((s) => s.isEditing)

  const { data: pbis, isLoading } = usePBIs(projectId, featureId)
  const createPBI = useCreatePBI(projectId)

  if (isLoading) {
    return <p className="text-xs text-gray-400 py-1">Loading…</p>
  }

  return (
    <div>
      {pbis?.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">No stories yet</p>
      ) : (
        <div className="space-y-0.5">
          {pbis?.map((pbi) => (
            <PBIRow key={pbi.system_id} pbi={pbi} projectId={projectId} />
          ))}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-3">
        <button
          onClick={() => setCreateType('story')}
          disabled={!isEditing}
          title={isEditing ? undefined : 'Request Edit Mode to add items'}
          className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
        >
          + PBI
        </button>
        <button
          onClick={() => setCreateType('bug')}
          disabled={!isEditing}
          title={isEditing ? undefined : 'Request Edit Mode to add items'}
          className="text-xs text-red-500 hover:text-red-700 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
        >
          + Bug
        </button>
      </div>

      <PBIFormModal
        open={createType !== null}
        defaultType={createType ?? 'story'}
        onClose={() => setCreateType(null)}
        onSubmit={(values) =>
          createPBI.mutateAsync({
            ...(values as PBICreate),
            parent_feature_system_id: featureId,
          })
        }
      />
    </div>
  )
}
