import { useState } from 'react'
import type { AxiosError } from 'axios'
import { useDeleteState, useStates } from '@/hooks/useStates'
import type { ProjectState, StateItemType } from '@/types'

const LIST_LABELS: Array<{ itemType: StateItemType; label: string }> = [
  { itemType: 'feature', label: 'Features' },
  { itemType: 'story', label: 'PBIs' },
  { itemType: 'bug', label: 'Bugs' },
]

interface Props {
  readonly projectId: string
}

/**
 * The project's three State Lists, with a delete for entries no item uses.
 * Deleting an in-use State is refused by the backend and reported inline.
 */
export function ProjectStatesSection({ projectId }: Props) {
  const { data: states = [], isLoading } = useStates(projectId)
  const deleteState = useDeleteState(projectId)
  const [error, setError] = useState<{ stateId: string; message: string } | null>(null)

  const handleDelete = async (state: ProjectState) => {
    setError(null)
    try {
      await deleteState.mutateAsync(state.system_id)
    } catch (err) {
      const detail = (err as AxiosError<{ detail?: { message?: string } }>)?.response?.data?.detail
      setError({
        stateId: state.system_id,
        message: detail?.message ?? 'Could not delete this State',
      })
    }
  }

  if (isLoading) return null

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
      <p className="block text-sm font-medium text-gray-700 dark:text-gray-300">States</p>
      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
        Populated by CSV import and by typing a new State on an item. A State still used
        by an item cannot be removed.
      </p>

      <div className="mt-3 space-y-3">
        {LIST_LABELS.map(({ itemType, label }) => {
          const listStates = states.filter((s) => s.item_type === itemType)
          return (
            <div key={itemType}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
              {listStates.length === 0 ? (
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 italic">None yet</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {listStates.map((state) => (
                    <li key={state.system_id}>
                      <span className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-200">
                        {state.value}
                        <button
                          type="button"
                          aria-label={`Remove State ${state.value}`}
                          onClick={() => handleDelete(state)}
                          disabled={deleteState.isPending}
                          className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error.message}</p>}
    </div>
  )
}
