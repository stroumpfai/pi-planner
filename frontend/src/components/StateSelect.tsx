import { useId } from 'react'
import { useStatesForType } from '@/hooks/useStates'
import { useUiStore } from '@/stores/uiStore'
import type { StateItemType } from '@/types'

interface Props {
  readonly itemType: StateItemType
  /** The chosen State's system_id, or null/'' for no State. */
  readonly value: string | null
  readonly onChange: (stateId: string | null) => void
  /** Defaults to the active project. Pass explicitly when the item's project is known. */
  readonly projectId?: string
  readonly disabled?: boolean
}

/**
 * Picks a State from the project's list for this item type. The list is fixed
 * vocabulary — it is edited in Edit Project → Manage States, never from here, so a
 * typo can't join the list by being typed into an item. Blank means no State.
 */
export function StateSelect({ itemType, value, onChange, projectId, disabled = false }: Props) {
  const activeProjectId = useUiStore((s) => s.activeProjectId)
  const resolvedProjectId = projectId ?? activeProjectId ?? ''
  const selectId = useId()

  const { states } = useStatesForType(resolvedProjectId, itemType)
  const isEmpty = states.length === 0

  const selectClass = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed'

  return (
    <div>
      <label htmlFor={selectId} className="block text-sm font-medium text-gray-700">
        State <span className="text-gray-400 font-normal">(optional)</span>
      </label>
      <select
        id={selectId}
        value={value ?? ''}
        disabled={disabled || isEmpty}
        onChange={(e) => onChange(e.target.value || null)}
        className={selectClass}
        data-testid="state-select"
      >
        <option value="">(none)</option>
        {states.map((s) => (
          <option key={s.system_id} value={s.system_id}>
            {s.value}
          </option>
        ))}
      </select>
      {isEmpty && !disabled && (
        <p className="mt-1 text-xs text-gray-500">
          This project has no States for this item type yet. Import a CSV with a State
          column, or add them in Edit Project → Manage States.
        </p>
      )}
    </div>
  )
}
