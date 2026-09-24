interface Props {
  readonly id: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

/**
 * Whether a member's capacity reaches the team total (teams.md §3.2).
 *
 * Off is for someone the team tracks for their absences only — a PO, an SM, a
 * stakeholder. Their row stays everywhere else; the Capacity view shows their
 * numbers under the total rather than in it.
 *
 * A plain checkbox rather than a switch: it sits in a form that is submitted,
 * and a switch reads as taking effect the moment it is flipped.
 */
export function CountsTowardsCapacityField({ id, checked, onChange }: Props) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Counts towards capacity
        </label>
        <p id={`${id}-hint`} className="text-xs text-gray-400 dark:text-gray-500">
          Untick for people you track absences for but who bring no development capacity — a
          PO, an SM, a stakeholder.
        </p>
      </div>
    </div>
  )
}
