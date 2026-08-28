import { useEffect, useRef, useState } from 'react'
import { useFeatures, useCreateFeature } from '@/hooks/useFeatures'
import { usePBIs } from '@/hooks/usePBIs'
import { usePIs } from '@/hooks/usePIs'
import { useEffortUnit } from '@/hooks/useProjects'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { FeatureRow } from '@/components/FeatureRow'
import { FeatureFormModal } from '@/components/FeatureFormModal'
import { ImportCSVModal } from '@/components/ImportCSVModal'
import { ClearBacklogModal } from '@/components/ClearBacklogModal'

type Sort = 'created_at' | 'name'

const SORT_KEY = 'pi-planner:backlog-sort'

interface Props {
  readonly projectId: string
}

export function BacklogPage({ projectId }: Props) {
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem(SORT_KEY) as Sort) ?? 'created_at')
  const [showCreate, setShowCreate] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [showImport, setShowImport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEditing = useAuthStore((s) => s.isEditing)

  const { data: features, isLoading } = useFeatures(projectId, sort)
  const { data: pbis } = usePBIs(projectId)
  // Removed features may span several PIs; the reconcile step names them.
  const { data: pis } = usePIs(projectId)
  const createFeature = useCreateFeature(projectId)
  const effortUnit = useEffortUnit(projectId)
  const showEffortUnit = useSettingsStore((s) => s.showEffortUnit)
  const unitSuffix = showEffortUnit ? ` ${effortUnit}` : ''

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])

  const backlogFeatures = features?.filter((f) => f.location === 'backlog') ?? []
  const totalEffort = backlogFeatures.reduce((sum, f) => sum + (f.effort ?? 0), 0)

  const backlogPBIs = pbis?.filter((p) => p.location === 'backlog') ?? []
  const pbiCount = backlogPBIs.filter((p) => p.item_type === 'story').length
  const bugCount = backlogPBIs.filter((p) => p.item_type === 'bug').length

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file) {
      setSelectedFile(file)
      setShowImport(true)
    }
    // Reset input so selecting the same file again still fires onChange
    e.target.value = ''
  }

  function handleImportClose() {
    setShowImport(false)
    setSelectedFile(null)
  }

  return (
    <div className="h-full overflow-y-auto bg-canvas">
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Backlog</h2>

          <div className="flex items-center gap-3 shrink-0">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              onClick={() => setShowClear(true)}
              disabled={!isEditing}
              title={isEditing ? undefined : 'Request Edit Mode to clear features'}
              className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!isEditing}
              title={isEditing ? undefined : 'Request Edit Mode to import'}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import CSV
            </button>

            <button
              onClick={() => setShowCreate(true)}
              disabled={!isEditing}
              title={isEditing ? undefined : 'Request Edit Mode to add features'}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Feature
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 mt-2">
          {/* Sort toggle */}
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <span>Sort:</span>
            <button
              onClick={() => setSort('created_at')}
              className={`px-2 py-0.5 rounded ${sort === 'created_at' ? 'bg-gray-200 dark:bg-gray-700 font-medium text-gray-800 dark:text-gray-200' : 'hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              Newest
            </button>
            <button
              onClick={() => setSort('name')}
              className={`px-2 py-0.5 rounded ${sort === 'name' ? 'bg-gray-200 dark:bg-gray-700 font-medium text-gray-800 dark:text-gray-200' : 'hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              Name
            </button>
          </div>

          {/* Summary chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 dark:text-gray-500 bg-canvas shadow-soft-sm rounded-full px-2 py-0.5">
              {backlogFeatures.length} feature{backlogFeatures.length === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 bg-canvas shadow-soft-sm rounded-full px-2 py-0.5">
              {pbiCount} PBI{pbiCount === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 bg-canvas shadow-soft-sm rounded-full px-2 py-0.5">
              {bugCount} bug{bugCount === 1 ? '' : 's'}
            </span>
            {totalEffort > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{totalEffort}{unitSuffix} total</span>
            )}
          </div>
        </div>
      </div>

      {/* Feature list */}
      {isLoading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}
      {!isLoading && backlogFeatures.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          <p className="text-gray-400 dark:text-gray-500 font-medium">No features in the backlog</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">
            {isEditing ? 'Click "+ Feature" to add one.' : 'Request Edit Mode to add features.'}
          </p>
        </div>
      )}
      {!isLoading && backlogFeatures.length > 0 && (
        <div className="shadow-soft rounded-xl bg-canvas divide-y divide-white/60">
          {backlogFeatures.map((feature) => (
            <FeatureRow key={feature.system_id} feature={feature} projectId={projectId} />
          ))}
        </div>
      )}

      <FeatureFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(values) => createFeature.mutateAsync(values)}
      />

      <ImportCSVModal
        open={showImport}
        projectId={projectId}
        file={selectedFile}
        features={features ?? []}
        pbis={pbis ?? []}
        pis={pis ?? []}
        onClose={handleImportClose}
      />

      <ClearBacklogModal
        open={showClear}
        projectId={projectId}
        backlogCount={backlogFeatures.length}
        totalCount={features?.length ?? 0}
        onClose={() => setShowClear(false)}
      />
    </div>
    </div>
  )
}
