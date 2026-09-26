/**
 * The line every team view draws above its first member who does not count.
 *
 * Dashed, so it reads as a different kind of line from the row dividers without
 * claiming to be a total rule — only the Capacity and Meetings views have a sum
 * for a solid rule to sit above. Marked `!` because the lists draw their row
 * dividers with `divide-y`, whose selector outranks a plain border class.
 */
export const NOT_COUNTED_RULE = '!border-t-2 !border-dashed !border-gray-300 dark:!border-gray-600'

/**
 * The marker beside the name of a member who does not count towards capacity
 * (teams.md §3.2): a chip rather than a column, because nearly every row counts
 * and a column of "yes" would say nothing.
 */
export function NotCountedChip() {
  return (
    <span
      title="Absences are tracked, but this member's capacity is not in the team total"
      className="flex-shrink-0 px-1.5 py-0.5 rounded bg-band text-[10px] font-normal text-gray-500 dark:text-gray-400 whitespace-nowrap"
    >
      not counted
    </span>
  )
}
