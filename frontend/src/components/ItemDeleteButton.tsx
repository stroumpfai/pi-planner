interface Props {
  /** Opens the delete confirmation for the item. */
  readonly onActivate: () => void
  /** When the button lives inside a drag handle, stop pointer/click from starting a drag. */
  readonly withinDragHandle?: boolean
}

/**
 * Hover-revealed delete action for a backlog work item (feature or PBI). Red trash
 * icon; shown only in edit mode by the caller. Requires an ancestor with the
 * Tailwind `group` class for the hover reveal.
 */
export function ItemDeleteButton({ onActivate, withinDragHandle = false }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => { if (withinDragHandle) e.stopPropagation(); onActivate() }}
      onPointerDown={withinDragHandle ? (e) => e.stopPropagation() : undefined}
      aria-label="Delete"
      title="Delete"
      className="shrink-0 text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
      </svg>
    </button>
  )
}
