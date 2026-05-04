import { useState } from 'react'
import { usePBIs, useCreatePBI } from '@/hooks/usePBIs'
import { useAuthStore } from '@/stores/authStore'
import { PBIRow } from './PBIRow'
import { PBIFormModal } from './PBIFormModal'
import type { PBICreate } from '@/types'

interface Props {
  featureId: string
  projectId: string
}

export function PBIList({ featureId, projectId }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const isEditing = useAuthStore((s) => s.isEditing)

  const { data: pbis, isLoading } = usePBIs(projectId, featureId)
  const createPBI = useCreatePBI(projectId)

  if (isLoading) {
    return <p className="text-xs text-gray-400 py-1">Loading…</p>
  }

  return (
    <div>
      {pbis?.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">No PBIs yet</p>
      ) : (
        <div className="space-y-0.5">
          {pbis?.map((pbi) => (
            <PBIRow key={pbi.system_id} pbi={pbi} projectId={projectId} />
          ))}
        </div>
      )}

      <button
        onClick={() => setShowCreate(true)}
        disabled={!isEditing}
        title={isEditing ? undefined : 'Request Edit Mode to add PBIs'}
        className="mt-1.5 text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 disabled:cursor-not-allowed"
      >
        + Add PBI
      </button>

      <PBIFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
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
