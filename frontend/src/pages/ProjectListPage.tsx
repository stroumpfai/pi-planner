import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects, useDeleteProject } from '@/hooks/useProjects'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { CreateProjectModal } from '@/components/CreateProjectModal'
import { EditProjectModal } from '@/components/EditProjectModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SnapshotsModal } from '@/components/SnapshotsModal'
import { ProjectSettingsModal } from '@/components/ProjectSettingsModal'
import type { Project } from '@/types'

function ExportButton({ project }: { readonly project: Project }) {
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const resp = await fetch(`/api/v1/projects/${project.system_id}/export`, { credentials: 'include' })
      const blob = await resp.blob()
      const disposition = resp.headers.get('Content-Disposition') ?? ''
      const match = /filename="?([^"]+)"?/.exec(disposition)
      const filename = match?.[1] ?? `${project.name}.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
      title="Export project as JSON"
    >
      {loading ? 'Exporting…' : 'Export'}
    </button>
  )
}

function ImportButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/api/v1/projects/import', {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        setError(body?.detail?.message ?? 'Import failed')
        return
      }
      await qc.invalidateQueries({ queryKey: ['projects'] })
    } catch {
      setError('Import failed')
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Import project file"
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="px-4 py-2 text-sm font-medium text-gray-700 bg-canvas shadow-soft-sm hover:shadow-soft rounded-xl border-none transition-shadow disabled:opacity-50"
      >
        {loading ? 'Importing…' : 'Import'}
      </button>
      {error && (
        <p className="absolute top-full right-0 mt-1 text-xs text-red-500 whitespace-nowrap">
          {error}
        </p>
      )}
    </div>
  )
}

export function ProjectListPage() {
  const { data: projects, isLoading } = useProjects()
  const deleteProject = useDeleteProject()
  const setActiveProject = useUiStore((s) => s.setActiveProject)
  const canEdit = useAuthStore((s) => s.canEdit())
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [snapshotsTarget, setSnapshotsTarget] = useState<Project | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<Project | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-gray-400 text-sm">Loading projects…</span>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Projects</h1>
        {canEdit && (
          <div className="flex items-center gap-2">
            <ImportButton />
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              + New Project
            </button>
          </div>
        )}
      </div>

      {projects?.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1">Create your first project to get started.</p>
        </div>
      ) : (
        <ul className="divide-y divide-white/60 shadow-soft rounded-xl bg-canvas">
          {projects?.map((project) => (
            <li key={project.system_id} className="px-4 py-4 hover:bg-band/40">
              <div className="flex items-start gap-4">
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => setActiveProject(project.system_id)}
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{project.name}</p>
                  {project.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{project.description}</p>
                  )}
                </button>
                {canEdit && (
                  <div className="flex items-center gap-3 shrink-0 pt-0.5">
                    <button
                      onClick={() => setEditTarget(project)}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >
                      Edit
                    </button>
                    <ExportButton project={project} />
                    <button
                      onClick={() => setSettingsTarget(project)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Settings
                    </button>
                    <button
                      onClick={() => setSnapshotsTarget(project)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Snapshots
                    </button>
                    <button
                      onClick={() => setDeleteTarget(project)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} />

      {editTarget && (
        <EditProjectModal
          open
          project={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {snapshotsTarget && (
        <SnapshotsModal
          projectId={snapshotsTarget.system_id}
          open={snapshotsTarget !== null}
          onClose={() => setSnapshotsTarget(null)}
        />
      )}

      {settingsTarget && (
        <ProjectSettingsModal
          projectId={settingsTarget.system_id}
          open={settingsTarget !== null}
          onClose={() => setSettingsTarget(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete project"
        description={`"${deleteTarget?.name}" and all its data will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteProject.mutate(deleteTarget.system_id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
