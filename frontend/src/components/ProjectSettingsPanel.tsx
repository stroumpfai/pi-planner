import { useEffect, useState } from 'react'
import { useProject, useUpdateProject } from '@/hooks/useProjects'
import { useSettingsStore } from '@/stores/settingsStore'

interface Props {
  readonly projectId: string
}

export function ProjectSettingsPanel({ projectId }: Props) {
  const { data: project } = useProject(projectId)
  const updateProject = useUpdateProject(projectId)
  const showIds = useSettingsStore((s) => s.showIds)
  const setShowIds = useSettingsStore((s) => s.setShowIds)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const setShowEffortUnit = useSettingsStore((s) => s.setShowEffortUnit)

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
    <div className="w-60 flex-shrink-0 border-l border-gray-200 bg-white px-4 py-6 overflow-y-auto">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Project Settings
      </h3>

      <div className="space-y-6">
        <div>
          <label htmlFor="effort-unit" className="block text-sm font-medium text-gray-700 mb-1">
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
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="pts"
          />
          <p className="text-xs text-gray-400 mt-1">
            Label shown next to effort and capacity values
          </p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Show IDs</p>
            <p className="text-xs text-gray-400 mt-0.5">Feature and story identifiers</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showIds}
            aria-label="Show IDs"
            onClick={() => setShowIds(!showIds)}
            className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
              showIds ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                showIds ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Show effort unit</p>
            <p className="text-xs text-gray-400 mt-0.5">Unit label next to effort and capacity values</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showEffortUnit}
            aria-label="Show effort unit"
            onClick={() => setShowEffortUnit(!showEffortUnit)}
            className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
              showEffortUnit ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                showEffortUnit ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
