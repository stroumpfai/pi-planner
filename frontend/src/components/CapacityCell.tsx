import type { CapacityBreakdown } from '@/types'
import { fmt1 } from '@/utils/sprintLabels'

interface Props {
  readonly breakdown: CapacityBreakdown | null
  readonly label: string
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly normalDayHours: number
  readonly emphasis?: boolean
}

/**
 * One member-and-sprint figure, and the chain behind it (teams.md §7.6).
 *
 * **PD leads, hours sit beneath.** They are one number in two units (§5.2), so
 * which leads is a question about the reader: people plan and talk in
 * person-days, and the spreadsheets this replaces have no hours in them at all.
 * Hours stay directly beneath as the exact figure, the one that traces.
 *
 * **Presence is a separate line**, because it answers a different question:
 * someone can be around for 9 days and contribute 6.3 PD when their day is 6 h.
 * Conflating the two is exactly what the normalised person-day exists to prevent.
 *
 * **A null breakdown renders "—", never 0.** An undated sprint is unknown, not
 * empty, and a zero here would read as a team that does no work (§5.3).
 *
 * Expanding shows the §5.4 steps in order. This is the view's whole purpose: the
 * collapsed cell is the summary, and the chain is what lets a surprising number
 * be traced to its cause rather than argued about.
 */
export function CapacityCell({
  breakdown,
  label,
  expanded,
  onToggle,
  normalDayHours,
  emphasis = false,
}: Props) {
  if (!breakdown) {
    return (
      <td className="px-3 py-2 text-center text-sm text-gray-300 dark:text-gray-600" title="This sprint has no dates">
        —
      </td>
    )
  }

  return (
    <td className="px-3 py-2 align-top">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${label}: ${fmt1(breakdown.person_days)} person-days`}
        className={`w-full text-left rounded-lg px-2 py-1 hover:bg-band/60 ${
          expanded ? 'bg-band shadow-soft-inset' : ''
        }`}
      >
        <span className={`block ${emphasis ? 'text-sm font-semibold' : 'text-sm font-medium'} text-gray-900 dark:text-gray-100`}>
          {fmt1(breakdown.person_days)} PD
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          {fmt1(breakdown.net_hours)} h
        </span>
        <span className="block text-[11px] text-gray-400 dark:text-gray-500">
          {fmt1(breakdown.present_days)} d present · {fmt1(breakdown.person_days)} PD
        </span>
      </button>

      {expanded && (
        <dl className="mt-2 px-2 pb-1 space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
          <Step
            term={`Contracted ${breakdown.contracted_half_days} half-days`}
            value={`${fmt1(breakdown.contracted_hours)} h`}
          />
          <Step
            term={`− absences (${breakdown.absent_half_days} half-days)`}
            value={`${fmt1(breakdown.hours_after_absences)} h`}
          />
          <Step
            term={`− meetings (${fmt1(breakdown.meeting_hours)} h)`}
            value={`${fmt1(breakdown.hours_after_meetings)} h`}
          />
          {/* Focus is per half-day and can differ inside one sprint, so the step
              names what it did rather than a single factor that may not exist. */}
          <Step term="× focus" value={`${fmt1(breakdown.net_hours)} h`} />
          <Step
            term={`÷ ${fmt1(normalDayHours)} h per day`}
            value={`${fmt1(breakdown.person_days)} PD`}
            strong
          />
        </dl>
      )}
    </td>
  )
}

interface StepProps {
  readonly term: string
  readonly value: string
  readonly strong?: boolean
}

function Step({ term, value, strong = false }: StepProps) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{term}</dt>
      <dd className={strong ? 'font-medium text-gray-700 dark:text-gray-200' : ''}>{value}</dd>
    </div>
  )
}
