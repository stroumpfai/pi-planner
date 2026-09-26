/** The one field every member-shaped row shares, whichever endpoint it came from. */
interface Countable {
  readonly counts_towards_capacity?: boolean
}

export interface CapacitySplit<T> {
  /** The people the team total is the sum of, in their saved order. */
  readonly counted: readonly T[]
  /** Tracked for their absences only (teams.md §3.2), in their saved order. */
  readonly notCounted: readonly T[]
}

/**
 * Members who count towards capacity, then those who do not.
 *
 * Every team view renders its rows in this order, so a member sits on the same
 * side of the line wherever they appear. The split is stable: within each group
 * the saved order is kept, so dragging in the Members view still means
 * something. A missing flag counts — true is the column's default (§3.2).
 */
export function splitByCapacity<T extends Countable>(members: readonly T[]): CapacitySplit<T> {
  return {
    counted: members.filter((m) => m.counts_towards_capacity !== false),
    notCounted: members.filter((m) => m.counts_towards_capacity === false),
  }
}
