import { useState } from 'react'
import type { Feature } from '@/types'
import { FeatureFormModal } from './FeatureFormModal'
import { ConfirmDialog } from './ConfirmDialog'
import { PBIList } from './PBIList'
import { ItemEditButton } from './ItemEditButton'
import { ItemDeleteButton } from './ItemDeleteButton'
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
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)

  const updateFeature = useUpdateFeature(projectId)
  const deleteFeature = useDeleteFeature(projectId)

  const displayId = showIds && feature.id != null ? `[${feature.id}] ` : ''
  const unitSuffix = showEffortUnit ? effortUnit : ''
  const effortLabel = feature.effort == null ? null : `${feature.effort}${unitSuffix}`

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-band/40 group">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 w-5 text-xs shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>

        {/* Title */}
        <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">
          {displayId && <span className="font-mono text-gray-500 dark:text-gray-400">{displayId}</span>}
          {feature.title}
        </span>

        {/* Trailing controls, mirroring the cards: delete, view/edit, effort.
            Delete is hover-revealed and only in edit mode. */}
        {isEditing && <ItemDeleteButton onActivate={() => setConfirming(true)} />}

        <ItemEditButton editable={isEditing} onActivate={() => setEditing(true)} />

        {/* Effort badge */}
        {effortLabel && (
          <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full shadow-soft-sm px-1.5 py-0.5 font-medium shrink-0">
            {effortLabel}
          </span>
        )}
      </div>

      {expanded && (
        <div className="pl-9 pr-4 pb-2">
          <PBIList featureId={feature.system_id} projectId={projectId} />
        </div>
      )}

      <FeatureFormModal
        open={editing}
        feature={feature}
        readOnly={!isEditing}
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
