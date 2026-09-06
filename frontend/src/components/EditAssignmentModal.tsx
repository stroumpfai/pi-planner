import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useUpdateAssignment } from '@/hooks/useTeamProjects'
import { assignmentErrorCode } from '@/services/teamProjects'
import type { TeamAssignment } from '@/types'

interface Props {
  readonly open: boolean
  readonly teamId: string
  readonly assignment: TeamAssignment
  readonly onClose: () => void
}

const CHANGED_MESSAGE =
  'This assignment changed while you had it open — the list has been refreshed. Check the current values and try again.'

/** Change a project's share, its conversion, or where its Available comes from (§6.3, §6.4). */
export function EditAssignmentModal({ open, teamId, assignment, onClose }: Props) {
  const update = useUpdateAssignment(teamId)

  const [sharePct, setSharePct] = useState(String(assignment.share_pct))
  const [source, setSource] = useState<'manual' | 'factor'>(
    assignment.available_source === 'factor' ? 'factor' : 'manual',
  )
  const [unitsPerPd, setUnitsPerPd] = useState(String(assignment.units_per_pd))
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await update.mutateAsync({
        projectId: assignment.project_id,
        // The tag of the row this form was opened on, not a fresh one (§4.2).
        etag: assignment.etag ?? '',
        body: {
          share_pct: Number(sharePct),
          available_source: source,
          units_per_pd: Number(unitsPerPd),
        },
      })
      onClose()
    } catch (err) {
      setError(
        assignmentErrorCode(err) === 'STALE'
          ? CHANGED_MESSAGE
          : 'Could not save the assignment — please try again.',
      )
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {assignment.project_name}
          </Dialog.Title>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="edit-share" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Share of the team
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="edit-share"
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
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="radio"
                  name="available_source"
                  value="manual"
                  checked={source === 'manual'}
                  onChange={() => setSource('manual')}
                />
                Typed by hand
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="radio"
                  name="available_source"
                  value="factor"
                  checked={source === 'factor'}
                  onChange={() => setSource('factor')}
                />
                Derived from the team
              </label>
            </fieldset>

            {source === 'factor' && (
              <div>
                <label htmlFor="edit-units" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {assignment.effort_unit} per person-day
                </label>
                <input
                  id="edit-units"
                  name="units_per_pd"
                  type="number"
                  step="any"
                  value={unitsPerPd}
                  onChange={(e) => setUnitsPerPd(e.target.value)}
                  className="mt-1 block w-32 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                />
              </div>
            )}

            <p className="text-xs text-gray-400 dark:text-gray-500">
              Changing either writes nothing to {assignment.project_name}. Capacity reaches a sprint
              only through an explicit update.
            </p>

            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={update.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
