import { useEffect, useRef, useState } from 'react'
import { useFeatures, useCreateFeature } from '@/hooks/useFeatures'
import { useAuthStore } from '@/stores/authStore'
import { FeatureRow } from '@/components/FeatureRow'
import { FeatureFormModal } from '@/components/FeatureFormModal'
import { ImportCSVModal } from '@/components/ImportCSVModal'

type Sort = 'created_at' | 'name'

const SORT_KEY = 'pi-planner:backlog-sort'

interface Props {
  projectId: string
}

export function BacklogPage({ projectId }: Props) {
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem(SORT_KEY) as Sort) ?? 'created_at')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [showImport, setShowImport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEditing = useAuthStore((s) => s.isEditing)

  const { data: features, isLoading } = useFeatures(projectId, sort)
  const createFeature = useCreateFeature(projectId)

  useEffect(() => {
    localStorage.setItem(SORT_KEY, sort)
  }, [sort])

  const backlogFeatures = features?.filter((f) => f.location === 'backlog') ?? []

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
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">Backlog</h2>
        <div className="flex items-center gap-3">
          {/* Sort toggle */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>Sort:</span>
            <button
              onClick={() => setSort('created_at')}
              className={`px-2 py-0.5 rounded ${sort === 'created_at' ? 'bg-gray-200 font-medium text-gray-800' : 'hover:text-gray-700'}`}
            >
              Newest
            </button>
            <button
              onClick={() => setSort('name')}
              className={`px-2 py-0.5 rounded ${sort === 'name' ? 'bg-gray-200 font-medium text-gray-800' : 'hover:text-gray-700'}`}
            >
              Name
            </button>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isEditing}
            title={isEditing ? undefined : 'Request Edit Mode to import'}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* Feature list */}
      {isLoading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}
      {!isLoading && backlogFeatures.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <p className="text-gray-400 font-medium">No features in the backlog</p>
          <p className="text-gray-400 text-sm mt-1">
            {isEditing ? 'Click "+ Feature" to add one.' : 'Request Edit Mode to add features.'}
          </p>
        </div>
      )}
      {!isLoading && backlogFeatures.length > 0 && (
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
          {backlogFeatures.map((feature) => (
            <FeatureRow key={feature.system_id} feature={feature} projectId={projectId} />
          ))}
        </div>
      )}

      {/* Feature count */}
      {backlogFeatures.length > 0 && (
        <p className="mt-3 text-xs text-gray-400 text-right">
          {backlogFeatures.length} feature{backlogFeatures.length !== 1 ? 's' : ''}
        </p>
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
        onClose={handleImportClose}
      />
    </div>
  )
}
