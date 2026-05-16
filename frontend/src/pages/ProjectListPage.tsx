import { useState } from 'react'
import { useProjects, useDeleteProject } from '@/hooks/useProjects'
import { useUiStore } from '@/stores/uiStore'
import { CreateProjectModal } from '@/components/CreateProjectModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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

export function ProjectListPage() {
  const { data: projects, isLoading } = useProjects()
  const deleteProject = useDeleteProject()
  const setActiveProject = useUiStore((s) => s.setActiveProject)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)

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
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
        >
          + New Project
        </button>
      </div>

      {projects?.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No projects yet</p>
          <p className="text-sm mt-1">Create your first project to get started.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg bg-white">
          {projects?.map((project) => (
            <li key={project.system_id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <button
                className="flex-1 text-left"
                onClick={() => setActiveProject(project.system_id)}
              >
                <p className="text-sm font-medium text-gray-900">{project.name}</p>
                {project.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{project.description}</p>
                )}
              </button>
              <div className="flex items-center gap-3 ml-4 shrink-0">
                <ExportButton project={project} />
                <button
                  onClick={() => setDeleteTarget(project)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} />

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
