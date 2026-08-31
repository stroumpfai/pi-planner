import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects, useDeleteProject } from '@/hooks/useProjects'
import { useTeams } from '@/hooks/useTeams'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { CreateProjectModal } from '@/components/CreateProjectModal'
import { EditProjectModal } from '@/components/EditProjectModal'
import { CreateTeamModal } from '@/components/CreateTeamModal'
import { EditTeamModal } from '@/components/EditTeamModal'
import { DeleteTeamDialog } from '@/components/DeleteTeamDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SnapshotsModal } from '@/components/SnapshotsModal'
import type { Project, Team } from '@/types'

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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function ProjectListPage() {
  const { data: projects, isLoading } = useProjects()
  const { data: teams, isLoading: teamsLoading } = useTeams()
  const deleteProject = useDeleteProject()
  const setActiveProject = useUiStore((s) => s.setActiveProject)
  const setActiveTeam = useUiStore((s) => s.setActiveTeam)
  const canEdit = useAuthStore((s) => s.canEdit())
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [snapshotsTarget, setSnapshotsTarget] = useState<Project | null>(null)
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [editTeamTarget, setEditTeamTarget] = useState<Team | null>(null)
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<Team | null>(null)

  // A project carries no team field — the assignment is only visible from the team's
  // side, as `project_ids`. A project has at most one team (§6.1), so this inverts
  // cleanly into a lookup rather than a list per project.
  const teamByProject = useMemo(() => {
    const byProject = new Map<string, Team>()
    for (const team of teams ?? []) {
      for (const projectId of team.project_ids ?? []) byProject.set(projectId, team)
    }
    return byProject
  }, [teams])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-gray-400 text-sm">Loading projects…</span>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-10">
      {/* Projects and Teams are peers (§7.0), so neither owns the page's h1 and the
          landing page keeps a top-level heading of its own. */}
      <h1 className="sr-only">Home</h1>

      <section aria-labelledby="projects-heading">
        <div className="flex items-center justify-between mb-6">
          <h2 id="projects-heading" className="text-xl font-semibold text-gray-900 dark:text-gray-100">Projects</h2>
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
            {projects?.map((project) => {
              const team = teamByProject.get(project.system_id)
              return (
                <li key={project.system_id} className="px-4 py-4 hover:bg-band/40">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <button
                        className="block w-full text-left"
                        onClick={() => setActiveProject(project.system_id)}
                      >
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{project.name}</p>
                        {project.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{project.description}</p>
                        )}
                      </button>
                      {project.azure_devops_url && (
                        <a
                          href={project.azure_devops_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-block mt-1 max-w-full truncate text-xs text-blue-500 hover:text-blue-700"
                        >
                          Azure DevOps ↗
                        </a>
                      )}
                    </div>
                    {/* The staleness badge (Step 7) lands in this column beneath the
                        name, which is why it is a block and not inline text. */}
                    <div className="shrink-0 w-36 pt-0.5 text-xs">
                      {team ? (
                        <>
                          <span className="text-gray-700 dark:text-gray-300">{team.name}</span>
                          {/* The share is what this project gets of that team, so the
                              two belong on one line: a team name alone reads as though
                              the whole team were on it. */}
                          <span className="text-gray-400 dark:text-gray-500">
                            {' · '}
                            {team.project_shares?.[project.system_id] ?? 100}%
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">No team</span>
                      )}
                    </div>
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
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="teams-heading">
        <div className="flex items-center justify-between mb-6">
          <h2 id="teams-heading" className="text-xl font-semibold text-gray-900 dark:text-gray-100">Teams</h2>
          {canEdit && (
            <button
              onClick={() => setShowCreateTeam(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              + New Team
            </button>
          )}
        </div>

        {teamsLoading ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading teams…</p>
        ) : teams?.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
            <p className="text-sm">
              No teams yet — a team lets you compute sprint capacity from who is available.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/60 shadow-soft rounded-xl bg-canvas">
            {teams?.map((team) => (
              <li key={team.system_id} className="px-4 py-4 hover:bg-band/40">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <button className="block w-full text-left" onClick={() => setActiveTeam(team.system_id)}>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{team.name}</p>
                      {team.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{team.description}</p>
                      )}
                    </button>
                  </div>
                  {/* Per-project staleness badges belong beside these counts (§6.6) — Step 7. */}
                  <div className="shrink-0 w-36 pt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {plural(team.member_count ?? 0, 'member')} · {plural(team.project_ids?.length ?? 0, 'project')}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-3 shrink-0 pt-0.5">
                      <button
                        onClick={() => setEditTeamTarget(team)}
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTeamTarget(team)}
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
      </section>

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

      <CreateTeamModal open={showCreateTeam} onClose={() => setShowCreateTeam(false)} />

      {editTeamTarget && (
        <EditTeamModal open team={editTeamTarget} onClose={() => setEditTeamTarget(null)} />
      )}

      {deleteTeamTarget && (
        <DeleteTeamDialog team={deleteTeamTarget} onClose={() => setDeleteTeamTarget(null)} />
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
