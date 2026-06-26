import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useProject, useUpdateProject } from '@/hooks/useProjects'

interface Props {
  readonly projectId: string
  readonly open: boolean
  readonly onClose: () => void
}

export function ProjectSettingsModal({ projectId, open, onClose }: Props) {
  const { data: project } = useProject(projectId)
  const updateProject = useUpdateProject(projectId)

  const [unitDraft, setUnitDraft] = useState('')

  useEffect(() => {
    if (project?.effort_unit !== undefined) {
      setUnitDraft(project.effort_unit)
    }
  }, [project?.effort_unit])

  function handleUnitBlur() {
    const trimmed = unitDraft.trim()
    if (trimmed && trimmed !== project?.effort_unit) {
      updateProject.mutate({ effort_unit: trimmed })
    } else if (!trimmed) {
      setUnitDraft(project?.effort_unit ?? 'pts')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Project Settings{project?.name ? ` — ${project.name}` : ''}
          </Dialog.Title>

          <div className="mt-4">
            <label htmlFor="effort-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Effort unit
            </label>
            <input
              id="effort-unit"
              type="text"
              value={unitDraft}
              onChange={(e) => setUnitDraft(e.target.value)}
              onBlur={handleUnitBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              maxLength={20}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="pts"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Label shown next to effort and capacity values
            </p>
          </div>

          <div className="flex justify-end pt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
