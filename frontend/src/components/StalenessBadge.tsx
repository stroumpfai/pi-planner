import { fmtDateTime } from '@/utils/dates'
import type { ProjectPushStatus } from '@/types'

interface Props {
  readonly status: ProjectPushStatus | null
  /** Compact, for a table cell; the board header has room for the timestamp. */
  readonly showPushedAt?: boolean
}

/**
 * Whether a project's sprints still agree with its team (teams.md §6.6).
 *
 * Three states, drawn as three different weights on purpose:
 *
 * **"3 sprints differ"** is amber, because it is the one that asks for an action
 * — and it counts sprints that would *actually change*, never inputs that moved.
 * An absence added and removed again reports nothing, because a badge people
 * learn to ignore is worse than no badge at all.
 *
 * **"in sync"** and **"never pushed"** are grey and quiet. They are different
 * states and read differently: in sync means the numbers match, never pushed
 * means nothing has ever flowed and the board still shows hand-typed values.
 *
 * A `manual` project renders nothing at all. Nothing is meant to flow into it,
 * so it can never be behind, and a badge saying so would imply otherwise.
 */
export function StalenessBadge({ status, showPushedAt = false }: Props) {
  if (!status || status.available_source === 'manual') return null

  if (status.stale_sprints > 0) {
    return (
      <span
        role="status"
        className="shrink-0 px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      >
        {status.stale_sprints === 1
          ? '1 sprint differs from the team'
          : `${status.stale_sprints} sprints differ from the team`}
      </span>
    )
  }

  return (
    <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
      {status.last_pushed_at === null
        ? 'never pushed'
        : showPushedAt
          ? `in sync · pushed ${fmtDateTime(status.last_pushed_at)}`
          : 'in sync'}
    </span>
  )
}
