import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AxiosError } from 'axios'
import {
  useCreateState,
  useDeleteState,
  useRenameState,
  useReorderStates,
  useStates,
} from '@/hooks/useStates'
import type { ProjectState, StateItemType } from '@/types'

const LISTS: Array<{ itemType: StateItemType; label: string }> = [
  { itemType: 'feature', label: 'Features' },
  { itemType: 'story', label: 'PBIs' },
  { itemType: 'bug', label: 'Bugs' },
]

function errorMessage(err: unknown, fallback: string): string {
  const detail = (err as AxiosError<{ detail?: { message?: string } }>)?.response?.data?.detail
  return detail?.message ?? fallback
}

interface Props {
  readonly open: boolean
  readonly projectId: string
  readonly onClose: () => void
}

/**
 * The editor for a project's three State Lists: add, rename, reorder and delete.
 *
 * Every action is its own mutation applying immediately — which is why this is a
 * separate modal rather than a section of the project form, whose fields only apply
 * on Save. It opens on top of Edit Project without closing it, so unsaved fields there
 * survive.
 */
export function ProjectStatesModal({ open, projectId, onClose }: Props) {
  const { data: states = [], isLoading } = useStates(projectId, open)
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) { setError(null); onClose() } }}>
      <Dialog.Portal>
        {/* Above Edit Project's z-40 overlay / z-50 content, so this renders on top. */}
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Manage States
          </Dialog.Title>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Each item type has its own list. Renaming a State updates every item that
            carries it; a State still in use cannot be removed.
          </p>

          {error && (
            <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>
          )}

          {!isLoading && (
            <div className="mt-4 space-y-6">
              {LISTS.map(({ itemType, label }) => (
                <StateListEditor
                  key={itemType}
                  projectId={projectId}
                  itemType={itemType}
                  label={label}
                  states={states.filter((s) => s.item_type === itemType)}
                  onError={setError}
                />
              ))}
            </div>
          )}

          <div className="flex justify-end pt-6">
            <button
              type="button"
              onClick={() => { setError(null); onClose() }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface ListProps {
  readonly projectId: string
  readonly itemType: StateItemType
  readonly label: string
  readonly states: ProjectState[]
  readonly onError: (message: string | null) => void
}

function StateListEditor({ projectId, itemType, label, states, onError }: ListProps) {
  const createState = useCreateState(projectId)
  const renameState = useRenameState(projectId)
  const reorderStates = useReorderStates(projectId)
  const deleteState = useDeleteState(projectId)

  const [newValue, setNewValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')

  const handleAdd = async () => {
    const value = newValue.trim()
    if (!value) return
    onError(null)
    try {
      await createState.mutateAsync({ item_type: itemType, value })
      setNewValue('')
    } catch (err) {
      onError(errorMessage(err, `Could not add '${value}'`))
    }
  }

  const startRename = (state: ProjectState) => {
    onError(null)
    setEditingId(state.system_id)
    setDraftValue(state.value)
  }

  const handleRename = async (state: ProjectState) => {
    const value = draftValue.trim()
    if (!value || value === state.value) {
      setEditingId(null)
      return
    }
    onError(null)
    try {
      await renameState.mutateAsync({ stateId: state.system_id, value })
      setEditingId(null)
    } catch (err) {
      onError(errorMessage(err, `Could not rename '${state.value}'`))
    }
  }

  const handleMove = async (index: number, direction: -1 | 1) => {
    const order = states.map((s) => s.system_id)
    const target = index + direction
    ;[order[index], order[target]] = [order[target], order[index]]
    onError(null)
    try {
      await reorderStates.mutateAsync({ item_type: itemType, order })
    } catch (err) {
      onError(errorMessage(err, 'Could not reorder this list'))
    }
  }

  const handleDelete = async (state: ProjectState) => {
    onError(null)
    try {
      await deleteState.mutateAsync(state.system_id)
    } catch (err) {
      onError(errorMessage(err, `Could not delete '${state.value}'`))
    }
  }

  const buttonClass = 'px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-30 disabled:hover:text-gray-500'

  return (
    <section data-testid={`state-list-${itemType}`}>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</h3>

      {states.length === 0 ? (
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 italic">None yet</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded">
          {states.map((state, index) => (
            <li key={state.system_id} className="flex items-center gap-1 px-2 py-1.5">
              {editingId === state.system_id ? (
                <input
                  value={draftValue}
                  autoFocus
                  maxLength={100}
                  aria-label={`Rename ${state.value}`}
                  onChange={(e) => setDraftValue(e.target.value)}
                  onBlur={() => handleRename(state)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleRename(state) }
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 min-w-0 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm py-0.5"
                />
              ) : (
                <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">
                  {state.value}
                </span>
              )}

              <button
                type="button"
                aria-label={`Move ${state.value} up`}
                disabled={index === 0 || reorderStates.isPending}
                onClick={() => handleMove(index, -1)}
                className={buttonClass}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${state.value} down`}
                disabled={index === states.length - 1 || reorderStates.isPending}
                onClick={() => handleMove(index, 1)}
                className={buttonClass}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Rename ${state.value}`}
                onClick={() => startRename(state)}
                className={buttonClass}
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={`Delete ${state.value}`}
                disabled={deleteState.isPending}
                onClick={() => handleDelete(state)}
                className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-red-600 disabled:opacity-30"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={newValue}
          maxLength={100}
          placeholder={`Add a ${label.replace(/s$/, '')} State`}
          aria-label={`New ${label} State`}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
          className="flex-1 min-w-0 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newValue.trim() || createState.isPending}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  )
}
