import { useState } from 'react'
import type { Feature } from '@/types'
import { FeatureFormModal } from './FeatureFormModal'
import { ConfirmDialog } from './ConfirmDialog'
import { PBIList } from './PBIList'
import { useUpdateFeature, useDeleteFeature } from '@/hooks/useFeatures'
import { useAuthStore } from '@/stores/authStore'
import { useEffortUnit } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'

interface Props {
  readonly feature: Feature
  readonly projectId: string
}

export function FeatureRow({ feature, projectId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const isEditing = useAuthStore((s) => s.isEditing)
  const effortUnit = useEffortUnit(projectId)
  const showIds = useSettingsStore((s) => s.showIds)

  const updateFeature = useUpdateFeature(projectId)
  const deleteFeature = useDeleteFeature(projectId)

  const displayId = showIds && feature.id != null ? `[${feature.id}] ` : ''
  const effortLabel = feature.effort == null ? null : `${feature.effort}${effortUnit}`

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 group">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-gray-400 hover:text-gray-600 w-5 text-xs shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        {/* Title */}
        <span className="flex-1 text-sm text-gray-900 truncate">
          {displayId && <span className="font-mono text-gray-500">{displayId}</span>}
          {feature.title}
        </span>

        {/* Effort badge */}
        {effortLabel && (
          <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded shrink-0">
            {effortLabel}
          </span>
        )}

        {/* Actions — only visible in edit mode */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => isEditing && setEditing(true)}
            disabled={!isEditing}
            title={isEditing ? 'Edit' : 'Request Edit Mode to make changes'}
            className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            Edit
          </button>
          <button
            onClick={() => isEditing && setConfirming(true)}
            disabled={!isEditing}
            title={isEditing ? 'Delete' : 'Request Edit Mode to make changes'}
            className="text-xs text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div className="pl-9 pr-4 pb-2">
          <PBIList featureId={feature.system_id} projectId={projectId} />
        </div>
      )}

      <FeatureFormModal
        open={editing}
        feature={feature}
        onClose={() => setEditing(false)}
        onSubmit={(values) =>
          updateFeature.mutateAsync({ featureId: feature.system_id, body: values })
        }
      />

      <ConfirmDialog
        open={confirming}
        title="Delete feature"
        description={`"${feature.title}" and all its PBIs will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { deleteFeature.mutate(feature.system_id); setConfirming(false) }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
