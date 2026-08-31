import { useState } from 'react'
import { AssignProjectModal } from '@/components/AssignProjectModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EditAssignmentModal } from '@/components/EditAssignmentModal'
import { useTeamProjects, useUnassignProject } from '@/hooks/useTeamProjects'
import { assignmentErrorCode } from '@/services/teamProjects'
import { useAuthStore } from '@/stores/authStore'
import type { TeamAssignment } from '@/types'

interface Props {
  readonly teamId: string
}

/**
 * The projects this team serves (teams.md §6.3, §7.0.1; design brief §5.7).
 *
 * **Shares over 100% are warned about, never blocked.** Teams really are
 * overcommitted, and a planner that refuses to represent the situation it exists
 * to reveal is worse than one that colours it amber. Under 100% is normal —
 * slack, unassigned work — and is not flagged at all.
 *
 * The first row is the **anchor**: its sprint calendar is what the Capacity view
 * counts in. That is worth a badge, because nothing else on screen would explain
 * why the columns are the dates they are.
 */
export function TeamProjectsView({ teamId }: Props) {
  const { data: assignments, isLoading } = useTeamProjects(teamId)
  const canEdit = useAuthStore((s) => s.canEdit())
  const unassign = useUnassignProject(teamId)

  const [assigning, setAssigning] = useState(false)
  const [editing, setEditing] = useState<TeamAssignment | null>(null)
  const [unassigning, setUnassigning] = useState<TeamAssignment | null>(null)
  const [unassignError, setUnassignError] = useState<string | null>(null)

  const rows = assignments ?? []
  const totalShare = rows.reduce((sum, row) => sum + row.share_pct, 0)

  const confirmUnassign = async () => {
    if (!unassigning) return
    setUnassignError(null)
    try {
      await unassign.mutateAsync({
        projectId: unassigning.project_id,
        etag: unassigning.etag ?? '',
      })
      setUnassigning(null)
    } catch (err) {
      setUnassignError(
        assignmentErrorCode(err) === 'STALE'
          ? 'This assignment changed while the dialog was open — the list has been refreshed.'
          : 'Could not unassign the project — please try again.',
      )
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {rows.length === 1 ? '1 project served' : `${rows.length} projects served`}
        </h3>
        {canEdit && (
          <button
            onClick={() => setAssigning(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
          >
            + Assign project
          </button>
        )}
      </div>

      {totalShare > 100 && (
        <p
          role="status"
          className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2"
        >
          These shares add up to {totalShare}% of the team. That is allowed — teams really are
          overcommitted — but every project here is planned on capacity the team does not have.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading projects…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">
            This team serves no project yet. The first one assigned sets the sprint calendar its
            capacity is counted in.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/60 shadow-soft rounded-xl bg-canvas">
          {rows.map((row) => (
            <li key={row.project_id} className="px-4 py-3 flex items-center gap-4 hover:bg-band/40">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {row.project_name}
                  {row.is_anchor && (
                    <span
                      className="ml-2 px-2 py-0.5 text-[10px] rounded-full bg-band shadow-soft-inset text-gray-500 dark:text-gray-400"
                      title="This project's sprint dates are the team's calendar"
                    >
                      anchor
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {row.share_pct}% of the team ·{' '}
                  {row.available_source === 'factor'
                    ? `Available derived at ${row.units_per_pd} ${row.effort_unit}/PD`
                    : `Available typed by hand (${row.effort_unit})`}
                </p>
              </div>

              {/* The staleness badge belongs beside this line — step 7, once a
                  push exists for a project to be behind. */}

              {canEdit && (
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => setEditing(row)} className="text-xs text-blue-500 hover:text-blue-700">
                    Edit
                  </button>
                  <button
                    onClick={() => { setUnassignError(null); setUnassigning(row) }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Unassign
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AssignProjectModal
        open={assigning}
        teamId={teamId}
        assigned={rows}
        onClose={() => setAssigning(false)}
      />

      {editing && (
        <EditAssignmentModal open teamId={teamId} assignment={editing} onClose={() => setEditing(null)} />
      )}

      {unassigning && (
        <ConfirmDialog
          open
          destructive
          title={`Stop serving ${unassigning.project_name}?`}
          description={
            'Every sprint keeps the Available it holds now — nothing is recalculated or cleared, ' +
            'and the project goes back to a hand-typed budget. This team keeps its members and ' +
            'patterns.'
          }
          confirmLabel="Unassign"
          error={unassignError}
          confirmDisabled={unassign.isPending}
          onConfirm={confirmUnassign}
          onCancel={() => setUnassigning(null)}
        />
      )}
    </div>
  )
}
