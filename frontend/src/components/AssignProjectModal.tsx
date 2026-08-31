import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useProjects } from '@/hooks/useProjects'
import { useAssignProject } from '@/hooks/useTeamProjects'
import { assignmentErrorCode } from '@/services/teamProjects'
import { errorDetail } from '@/services/api'
import type { TeamAssignment } from '@/types'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly assigned: readonly TeamAssignment[]
  readonly onClose: () => void
}

/**
 * Assign a project to this team (teams.md §6.1, §6.3, §6.4).
 *
 * Two things this form is careful about:
 *
 * **The first project assigned is the anchor**, and the dialog says so while it
 * still matters. Its sprint calendar becomes the one every capacity figure for
 * this team is counted in, and picking the wrong one is only visible later, as
 * columns nobody planned against.
 *
 * **`manual` is the default and changes nothing.** Available stays whatever a
 * human typed; the team's capacity appears beside it as a reference. `factor`
 * makes it derivable — and still writes nothing until someone pushes.
 */
export function AssignProjectModal({ open, teamId, assigned, onClose }: Props) {
  const { data: projects } = useProjects()
  const assign = useAssignProject(teamId)

  const [projectId, setProjectId] = useState('')
  const [sharePct, setSharePct] = useState('100')
  const [source, setSource] = useState<'manual' | 'factor'>('manual')
  const [unitsPerPd, setUnitsPerPd] = useState('1')
  const [error, setError] = useState<string | null>(null)

  // A project already served by *this* team is filtered out here; one served by
  // another team is not, because the API's refusal names the holder and that is
  // more useful than a project quietly missing from the list.
  const options = useMemo(() => {
    const taken = new Set(assigned.map((a) => a.project_id))
    return (projects ?? []).filter((p) => !taken.has(p.system_id))
  }, [projects, assigned])

  const isFirst = assigned.length === 0

  const close = () => {
    setProjectId('')
    setSharePct('100')
    setSource('manual')
    setUnitsPerPd('1')
    setError(null)
    onClose()
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (projectId === '') {
      setError('Choose a project to assign.')
      return
    }
    try {
      await assign.mutateAsync({
        project_id: projectId,
        share_pct: Number(sharePct),
        available_source: source,
        units_per_pd: Number(unitsPerPd),
      })
      close()
    } catch (err) {
      const code = assignmentErrorCode(err)
      setError(
        code === 'PROJECT_ALREADY_ASSIGNED' || code === 'PROJECT_LIMIT_REACHED'
          ? (errorDetail(err)?.message ?? 'That project cannot be assigned.')
          : 'Could not assign the project — please try again.',
      )
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Assign project
          </Dialog.Title>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="assign-project" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Project <span className="text-red-500">*</span>
              </label>
              <select
                id="assign-project"
                name="project_id"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">Choose a project…</option>
                {options.map((project) => (
                  <option key={project.system_id} value={project.system_id}>{project.name}</option>
                ))}
              </select>
              {isFirst && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This is the team&rsquo;s first project, so its sprint dates become the calendar every
                  capacity figure here is counted in.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="assign-share" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Share of the team
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="assign-share"
                  name="share_pct"
                  type="number"
                  step="any"
                  value={sharePct}
                  onChange={(e) => setSharePct(e.target.value)}
                  className="block w-24 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">%</span>
              </div>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Available</legend>
              <label className="mt-2 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="radio"
                  name="available_source"
                  value="manual"
                  checked={source === 'manual'}
                  onChange={() => setSource('manual')}
                  className="mt-1"
                />
                <span>
                  Typed by hand
                  <span className="block text-xs text-gray-400 dark:text-gray-500">
                    Nothing changes; the team&rsquo;s capacity is shown beside it as a reference.
                  </span>
                </span>
              </label>
              <label className="mt-2 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="radio"
                  name="available_source"
                  value="factor"
                  checked={source === 'factor'}
                  onChange={() => setSource('factor')}
                  className="mt-1"
                />
                <span>
                  Derived from the team
                  <span className="block text-xs text-gray-400 dark:text-gray-500">
                    Still written only by an explicit update, never as a side effect.
                  </span>
                </span>
              </label>
            </fieldset>

            {source === 'factor' && (
              <div>
                <label htmlFor="assign-units" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Effort units per person-day
                </label>
                <input
                  id="assign-units"
                  name="units_per_pd"
                  type="number"
                  step="any"
                  value={unitsPerPd}
                  onChange={(e) => setUnitsPerPd(e.target.value)}
                  className="mt-1 block w-32 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Yours entirely — the app cannot tell points from hours and does not guess. Set 1.0
                  for a project measured in days. A wrong factor shows up as wrong numbers in the
                  review, before anything is written.
                </p>
              </div>
            )}

            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assign.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {assign.isPending ? 'Assigning…' : 'Assign project'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
