import { useId } from 'react'
import { useStatesForType } from '@/hooks/useStates'
import { useUiStore } from '@/stores/uiStore'
import type { StateItemType } from '@/types'

interface Props {
  readonly itemType: StateItemType
  readonly value: string
  readonly onChange: (value: string) => void
  /** Defaults to the active project. Pass explicitly when the item's project is known. */
  readonly projectId?: string
  readonly disabled?: boolean
}

/**
 * Picks a State from the project's list for this item type, and lets the user type a
 * value that isn't in the list yet — a typed value joins the list when the item is saved.
 * Blank means no State.
 */
export function StateSelect({ itemType, value, onChange, projectId, disabled = false }: Props) {
  const activeProjectId = useUiStore((s) => s.activeProjectId)
  const resolvedProjectId = projectId ?? activeProjectId ?? ''
  const listId = useId()
  const inputId = useId()

  const { states } = useStatesForType(resolvedProjectId, itemType)
  const isEmpty = states.length === 0

  const inputClass = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed'

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
        State <span className="text-gray-400 font-normal">(optional)</span>
      </label>
      <input
        id={inputId}
        list={listId}
        value={value}
        disabled={disabled}
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        placeholder={isEmpty ? 'No States yet — type to add one' : '(none)'}
        data-testid="state-select"
      />
      <datalist id={listId}>
        {states.map((s) => (
          <option key={s.system_id} value={s.value} />
        ))}
      </datalist>
      {isEmpty && !disabled && (
        <p className="mt-1 text-xs text-gray-500">
          This project has no States for this item type yet. Import a CSV with a State
          column, or type one here.
        </p>
      )}
    </div>
  )
}
