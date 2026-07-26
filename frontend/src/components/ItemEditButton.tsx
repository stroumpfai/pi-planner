interface Props {
  /** True when the current user holds the edit lock → pencil ("Edit"); false → eye ("View details"). */
  readonly editable: boolean
  /** Opens the item's form modal (editable or read-only depending on `editable`). */
  readonly onActivate: () => void
  /** When the button lives inside a drag handle, stop pointer/click from starting a drag. */
  readonly withinDragHandle?: boolean
}

/**
 * Hover-revealed action for a work item (feature or PBI). Shows a pencil when the
 * user can edit and an eye when they can only view — both open the same form modal,
 * which is rendered read-only in the view case. Requires an ancestor with the
 * Tailwind `group` class for the hover reveal.
 */
export function ItemEditButton({ editable, onActivate, withinDragHandle = false }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => { if (withinDragHandle) e.stopPropagation(); onActivate() }}
      onPointerDown={withinDragHandle ? (e) => e.stopPropagation() : undefined}
      aria-label={editable ? 'Edit' : 'View details'}
      title={editable ? 'Edit' : 'View details'}
      className="shrink-0 text-xs text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
    >
      {editable ? (
        '✎'
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
          <path d="M10 4C5.5 4 2 7 .5 10 2 13 5.5 16 10 16s8-3 9.5-6C18 7 14.5 4 10 4Zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
        </svg>
      )}
    </button>
  )
}
