import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useProjects, useDeleteProject } from '@/hooks/useProjects'
import { useTeams } from '@/hooks/useTeams'
import { statusFor, useTeamCapacityStatus } from '@/hooks/useTeamPush'
import { useUiStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { CreateProjectModal } from '@/components/CreateProjectModal'
import { EditProjectModal } from '@/components/EditProjectModal'
import { CreateTeamModal } from '@/components/CreateTeamModal'
import { StalenessBadge } from '@/components/StalenessBadge'
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
    <IconButton label={loading ? 'Exporting…' : 'Export'} onClick={handleExport} disabled={loading}>
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </IconButton>
  )
}

interface IconButtonProps {
  /** The accessible name **and** the tooltip: the glyph alone names nothing. */
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly destructive?: boolean
  readonly children: React.ReactNode
}

/**
 * One row action, drawn as a glyph (design §1: the Actions column is 92px).
 *
 * Four labelled text buttons would be wider than the project name they belong
 * to, which is why the design puts icons here — but an icon with no accessible
 * name is a button nobody can address, so `label` is both `aria-label` and
 * `title` and every test and spec selects by it.
 */
function IconButton({ label, onClick, disabled = false, destructive = false, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`p-1 rounded-lg transition-colors disabled:opacity-40 ${
        destructive
          ? 'text-gray-400 hover:text-red-600 dark:hover:text-red-400'
          : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400'
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
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

// The column templates the design fixes for the two tables. Readers lose the
// Actions column entirely — the badges stay, because staleness is information
// rather than an action (design §1).
const PROJECT_COLUMNS = 'grid-cols-[1.5fr_110px_150px_92px]'
const PROJECT_COLUMNS_READER = 'grid-cols-[1.5fr_110px_150px]'
const TEAM_COLUMNS = 'grid-cols-[1.1fr_74px_1.3fr_64px]'
const TEAM_COLUMNS_READER = 'grid-cols-[1.1fr_74px_1.3fr]'

interface ColumnHeadersProps {
  readonly columns: readonly string[]
  readonly template: string
}

/** The uppercase rule above each table — what makes the two lists read as columns. */
function ColumnHeaders({ columns, template }: ColumnHeadersProps) {
  return (
    <div
      aria-hidden="true"
      className={`grid ${template} gap-3 px-4 py-2 border-b border-white/60 dark:border-white/10 bg-band/30 text-[10.5px] uppercase tracking-[0.04em] text-gray-400 dark:text-gray-500`}
    >
      {columns.map((column) => (
        <span key={column} className={column === 'Actions' ? 'text-right' : ''}>
          {column}
        </span>
      ))}
    </div>
  )
}

interface ServedProjectsProps {
  readonly team: Team
  readonly nameOf: (projectId: string) => string
}

/**
 * What a team serves, one project per line with its share (design §1).
 *
 * The over-allocation warning lives here rather than on the project rows because
 * this is where the shares are all visible at once — a single project row cannot
 * show that its 70% is part of a 120% (§6.3). It warns and never blocks: teams
 * really are overcommitted, and the tool exists to show it.
 */
function ServedProjects({ team, nameOf }: ServedProjectsProps) {
  const served = team.project_ids ?? []
  if (served.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 pt-0.5">no project yet</p>
  }

  const shares = team.project_shares ?? {}
  const total = served.reduce((sum, projectId) => sum + (shares[projectId] ?? 0), 0)

  return (
    <div className="min-w-0 text-xs pt-0.5 space-y-0.5">
      {served.map((projectId) => (
        <p key={projectId} className="truncate text-gray-600 dark:text-gray-300">
          {nameOf(projectId)}{' '}
          <span className="text-gray-400 dark:text-gray-500">{shares[projectId] ?? 100}%</span>
        </p>
      ))}
      {total > 100 && (
        <p className="text-amber-600 dark:text-amber-400">Σ {total}% — over-allocated</p>
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
  // Staleness sits on the project row, one glance from the team that moved — the
  // whole reason projects and teams share this page (§6.6, §7.0).
  const { data: pushStatuses } = useTeamCapacityStatus()
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
  // The Serves column names each project a team serves, and only the projects
  // list holds names — the team carries ids and shares.
  const projectName = useMemo(() => {
    const byId = new Map((projects ?? []).map((project) => [project.system_id, project.name]))
    return (projectId: string) => byId.get(projectId) ?? 'unknown project'
  }, [projects])

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
    <div className="w-full max-w-7xl mx-auto py-8 px-6 overflow-y-auto">
      {/* Projects and Teams are peers (§7.0), so neither owns the page's h1 and the
          landing page keeps a top-level heading of its own. */}
      <h1 className="sr-only">Home</h1>

      {/* Side by side on a wide viewport, stacked on a narrow one. Projects gets the
          wider share because its rows carry a description and four actions; the
          point of the pairing is that a project and the team feeding it are one
          glance apart (§7.0). */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <section aria-labelledby="projects-heading" className="w-full lg:flex-[1.45] min-w-0">
          <div className="flex items-center justify-between mb-3">
            {/* The count sits beside the heading, not inside it: an accessible
                name of "Projects 4" would name the section after its own row count. */}
            <div className="flex items-baseline gap-2">
              <h2 id="projects-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Projects
              </h2>
              <span className="text-sm text-gray-400 dark:text-gray-500">{projects?.length ?? 0}</span>
            </div>
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
            <div className="bg-canvas shadow-soft rounded-xl overflow-hidden">
              <ColumnHeaders
                columns={canEdit ? ['Project', 'Source', 'Team', 'Actions'] : ['Project', 'Source', 'Team']}
                template={canEdit ? PROJECT_COLUMNS : PROJECT_COLUMNS_READER}
              />
              <ul className="divide-y divide-white/60">
                {projects?.map((project) => {
                  const team = teamByProject.get(project.system_id)
                  return (
                    <li
                      key={project.system_id}
                      className={`grid ${canEdit ? PROJECT_COLUMNS : PROJECT_COLUMNS_READER} gap-3 items-start px-4 py-3 hover:bg-band/40`}
                    >
                      <div className="min-w-0">
                        <button
                          className="block w-full text-left"
                          onClick={() => setActiveProject(project.system_id)}
                        >
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{project.name}</p>
                          {project.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
                              {project.description}
                            </p>
                          )}
                        </button>
                      </div>

                      <div className="min-w-0 text-xs pt-0.5">
                        {project.azure_devops_url ? (
                          <a
                            href={project.azure_devops_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="block max-w-full truncate text-blue-500 hover:text-blue-700"
                          >
                            Azure DevOps ↗
                          </a>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </div>

                      {/* Team and share read down one line, and the staleness badge
                          lands beneath them — which is why this column is a block
                          and not inline text. */}
                      <div className="min-w-0 text-xs pt-0.5">
                        {team ? (
                          <>
                            <p className="truncate">
                              <span className="text-gray-700 dark:text-gray-300">{team.name}</span>
                              {/* A team name alone reads as though the whole team were
                                  on this project; the share is what it actually gets. */}
                              <span className="text-gray-400 dark:text-gray-500">
                                {' · '}
                                {team.project_shares?.[project.system_id] ?? 100}%
                              </span>
                            </p>
                            <p className="mt-0.5">
                              <StalenessBadge status={statusFor(pushStatuses, project.system_id)} />
                            </p>
                          </>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">No team</span>
                        )}
                      </div>

                      {canEdit && (
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton label="Edit" onClick={() => setEditTarget(project)}>
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </IconButton>
                          <ExportButton project={project} />
                          <IconButton label="Snapshots" onClick={() => setSnapshotsTarget(project)}>
                            <rect x="3" y="3" width="13" height="13" rx="2" />
                            <path d="M8 21h11a2 2 0 0 0 2-2V8" />
                          </IconButton>
                          <IconButton label="Delete" destructive onClick={() => setDeleteTarget(project)}>
                            <path d="M4 7h16" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                            <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </IconButton>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>

        <section aria-labelledby="teams-heading" className="w-full lg:flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            {/* The count sits beside the heading, not inside it: an accessible
                name of "Teams 4" would name the section after its own row count. */}
            <div className="flex items-baseline gap-2">
              <h2 id="teams-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Teams
              </h2>
              <span className="text-sm text-gray-400 dark:text-gray-500">{teams?.length ?? 0}</span>
            </div>
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
            <div className="bg-canvas shadow-soft rounded-xl overflow-hidden">
              <ColumnHeaders
                columns={canEdit ? ['Team', 'Members', 'Serves', 'Actions'] : ['Team', 'Members', 'Serves']}
                template={canEdit ? TEAM_COLUMNS : TEAM_COLUMNS_READER}
              />
              <ul className="divide-y divide-white/60">
                {teams?.map((team) => (
                  <li
                    key={team.system_id}
                    className={`grid ${canEdit ? TEAM_COLUMNS : TEAM_COLUMNS_READER} gap-3 items-start px-4 py-3 hover:bg-band/40`}
                  >
                    <div className="min-w-0">
                      <button className="block w-full text-left" onClick={() => setActiveTeam(team.system_id)}>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{team.name}</p>
                        {team.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
                            {team.description}
                          </p>
                        )}
                      </button>
                    </div>

                    <div
                      className="text-xs text-gray-600 dark:text-gray-300 pt-0.5"
                      aria-label={plural(team.member_count ?? 0, 'member')}
                    >
                      {team.member_count ?? 0}
                    </div>

                    <ServedProjects team={team} nameOf={projectName} />

                    {canEdit && (
                      <div className="flex items-center justify-end gap-0.5">
                        <IconButton label="Edit" onClick={() => setEditTeamTarget(team)}>
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </IconButton>
                        <IconButton label="Delete" destructive onClick={() => setDeleteTeamTarget(team)}>
                          <path d="M4 7h16" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </IconButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

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
