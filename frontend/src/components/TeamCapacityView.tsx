import { useCallback, useEffect, useMemo, useState } from 'react'
import { CapacityCell } from '@/components/CapacityCell'
import { CapacityMembersSummary } from '@/components/CapacityMembersSummary'
import { TimelineMinimap } from '@/components/TimelineMinimap'
import { useTeamCapacity } from '@/hooks/useTeamProjects'
import type { CapacitySprint, MemberCapacityRow, ProjectCapacityRow } from '@/types'
import {
  bestSprintIndex,
  frameMonthFor,
  monthlyLostCapacity,
  sprintOffsetFor,
  windowHoldsMonth,
} from '@/utils/capacityMinimap'
import { splitByCapacity } from '@/utils/capacityMembers'
import { COMPACT_SELECT } from '@/utils/compactSelect'
import { fmt1, sprintDateRange, sprintLabel } from '@/utils/sprintLabels'
import {
  DEFAULT_STRIP_MONTHS,
  addMonths,
  monthLabel,
  monthOf,
  monthsFrom,
  stripStartFor,
  type YearMonth,
} from '@/utils/timelineMonths'
import { todayIso } from '@/utils/workingDays'

interface Props {
  readonly teamId: string
  /** Send the reader to Projects, where the sprint calendar comes from (§7.0.1). */
  readonly onOpenProjects: () => void
}

/** Six columns at a time — enough for a PI and a bit, and still readable (§7.6). */
const COLUMNS = 6

/**
 * The months the minimap's frame covers.
 *
 * Six, to say roughly what six sprint columns are worth, and **fixed** rather
 * than measured off the sprints inside the window: a frame that breathed as the
 * reader paged — narrow over a dense PI, wide over a sparse one — would move
 * for two reasons at once, and the one it is there to show is the position.
 */
const FRAME_MONTHS = 6

/** How far the jump reaches either side of today, as in the absences view (§7.4). */
const JUMP_BACK_MONTHS = 12
const JUMP_MONTHS = 36

/**
 * Capacity per member, per sprint (teams.md §7.6).
 *
 * The sprint calendar is the **anchor project's** — the first project assigned to
 * this team. Without one there is no calendar, and the view says so instead of
 * inventing months: a grid of dates nobody planned against would look like data.
 *
 * Nothing here writes. These figures reach a project only through an explicit
 * push (step 7), which is what makes it safe to show them to every reader.
 */
export function TeamCapacityView({ teamId, onOpenProjects }: Props) {
  const { data, isLoading } = useTeamCapacity(teamId)
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  // The strip opens on today and slides to the sprints once they arrive — see
  // the re-anchoring effect below. Guessing the calendar's own first month here
  // is not possible: the report has not been read yet.
  const [minimapStart, setMinimapStart] = useState<YearMonth>(() => monthOf(todayIso()))
  const [stripMonths, setStripMonths] = useState(DEFAULT_STRIP_MONTHS)

  /**
   * The month the reader named, while the table still reaches it.
   *
   * The frame has to answer a click with the month that was clicked. Deriving
   * it from the window instead puts it a month out whenever the best matching
   * sprint starts in the month before — 29 June to 10 July is the sprint July
   * asks for, and anchoring on its start date would answer a click on July with
   * a frame over June. `null` is "nobody named one": the arrows moved the table
   * and the frame follows it.
   */
  const [named, setNamed] = useState<YearMonth | null>(null)

  const sprints = useMemo(() => data?.sprints ?? [], [data])
  // Above the rule: the people the Team total is the sum of. Below it: people
  // tracked for their absences only — shown, never totalled (§3.2, §7.6).
  const { counted, notCounted } = useMemo(() => splitByCapacity(data?.members ?? []), [data])
  const months = useMemo(() => monthsFrom(minimapStart, stripMonths), [minimapStart, stripMonths])

  // The bars: person-days absences and meetings took out of each month (§7.6).
  const density = useMemo(
    () => monthlyLostCapacity(sprints, data?.team ?? [], data?.normal_day_hours ?? 0, months),
    [sprints, data, months],
  )

  /** Where the frame sits: the month named, or the one the window starts in. */
  const frameStart = useMemo(() => {
    const windowed = sprints.slice(offset, offset + COLUMNS)
    if (named && windowHoldsMonth(windowed, named)) return named
    return frameMonthFor(sprints, offset, monthOf(todayIso()))
  }, [sprints, offset, named])

  /**
   * Move the table to the sprint a month names.
   *
   * Every way of moving the viewport — a bar, the frame, the jump — arrives
   * here, so all three land on the same sprint for the same month. The strip
   * then follows the *sprint*, not the click: asking for a month in the gap
   * between two PIs and being shown the nearest sprint is the honest answer,
   * and leaving the frame hovering over the empty months instead would claim
   * the table is somewhere it is not.
   */
  const showMonth = useCallback(
    (target: YearMonth) => {
      const index = bestSprintIndex(sprints, target)
      if (index < 0) return
      const next = sprintOffsetFor(index, sprints.length, COLUMNS)
      setOffset(next)
      setNamed(target)
      const anchor = windowHoldsMonth(sprints.slice(next, next + COLUMNS), target)
        ? target
        : frameMonthFor(sprints, next, target)
      setMinimapStart((current) => stripStartFor(current, anchor, stripMonths, FRAME_MONTHS))
    },
    [sprints, stripMonths],
  )

  // The arrows and a resized strip move the frame too, and either can leave it
  // outside the months on screen. Re-anchor on where the table already is
  // rather than moving the reader.
  useEffect(() => {
    setMinimapStart((current) => stripStartFor(current, frameStart, stripMonths, FRAME_MONTHS))
  }, [frameStart, stripMonths])

  if (isLoading) {
    return <p className="p-6 text-sm text-gray-400 dark:text-gray-500">Computing capacity…</p>
  }

  if (!data || data.anchor_project_id === null) {
    return (
      <div className="p-6">
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">
            This team serves no project yet, so it has no sprint calendar to count in.
          </p>
          <button
            onClick={onOpenProjects}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Assign a project
          </button>
        </div>
      </div>
    )
  }

  const window = data.sprints.slice(offset, offset + COLUMNS)
  const indices = window.map((_, index) => offset + index)
  const atStart = offset === 0
  const atEnd = offset + COLUMNS >= data.sprints.length

  const toggle = (key: string) => setExpanded((current) => (current === key ? null : key))

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setNamed(null)
            setOffset(Math.max(0, offset - COLUMNS))
          }}
          disabled={atStart}
          aria-label="Earlier sprints"
          className="px-3 py-1 text-sm rounded-lg bg-canvas shadow-soft-sm text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:shadow-soft-hover"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => {
            setNamed(null)
            setOffset(Math.min(Math.max(0, data.sprints.length - COLUMNS), offset + COLUMNS))
          }}
          disabled={atEnd}
          aria-label="Later sprints"
          className="px-3 py-1 text-sm rounded-lg bg-canvas shadow-soft-sm text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:shadow-soft-hover"
        >
          ›
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          A person-day is {fmt1(data.normal_day_hours)} h of work for everyone — not anyone&rsquo;s own
          day. Click a figure to see how it was reached.
        </p>
      </div>

      <CapacityMembersSummary members={data.members} />

      {/* The same strip the absences view carries, over the same months and with
          the same three ways to move — what differs is what a bar counts and
          what a month resolves to (§7.4, §7.6). */}
      <div className="bg-canvas shadow-soft rounded-xl p-4">
        <TimelineMinimap
          windowStart={minimapStart}
          frameStart={frameStart}
          frameMonths={FRAME_MONTHS}
          density={density}
          describeDensity={(value) =>
            value > 0 ? `${fmt1(value)} person-days lost` : 'nothing lost'
          }
          onFrameStart={showMonth}
          stripMonths={stripMonths}
          onStripMonths={setStripMonths}
          hint={
            <>
              <p>Lost to absences</p>
              <p className="text-gray-500 dark:text-gray-400">and meetings</p>
            </>
          }
        >
          {/* The fallback for a sprint too far to drag to — quiet on purpose,
              since the frame and the bars are the primary controls (§7.4). */}
          <label className="flex items-baseline gap-1 text-[11px] text-gray-400 dark:text-gray-500">
            Jump to
            <select
              aria-label="Jump to month"
              value={`${frameStart.year}-${String(frameStart.month).padStart(2, '0')}`}
              onChange={(event) => showMonth(monthOf(`${event.target.value}-01`))}
              className="min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 pl-1 text-[11px] text-gray-600 dark:text-gray-300 hover:bg-band/60 focus:ring-1 focus:ring-blue-500"
              style={COMPACT_SELECT}
            >
              {monthsFrom(addMonths(monthOf(todayIso()), -JUMP_BACK_MONTHS), JUMP_MONTHS).map(
                (month) => (
                  <option
                    key={`${month.year}-${month.month}`}
                    value={`${month.year}-${String(month.month).padStart(2, '0')}`}
                  >
                    {monthLabel(month)}
                  </option>
                ),
              )}
            </select>
          </label>
        </TimelineMinimap>

        <p className="sr-only" aria-live="polite">
          {window.length > 0
            ? `Showing ${window[0].label} to ${window[window.length - 1].label}`
            : 'No sprints to show'}
        </p>
      </div>

      <div className="overflow-x-auto bg-canvas shadow-soft rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-band/40">
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-48">
                Member
              </th>
              {window.map((sprint) => (
                <th key={sprint.sprint_id} scope="col" className="px-3 py-3 text-left">
                  <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                    {sprintLabel(sprint.pi_name, sprint.sprint_number)}
                  </span>
                  <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                    {sprintDateRange(sprint.start_date, sprint.end_date)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-white/60">
            {counted.map((member) => (
              <MemberRow
                key={member.member_id}
                member={member}
                sprints={data.sprints}
                indices={indices}
                normalDayHours={data.normal_day_hours}
                expanded={expanded}
                onToggle={toggle}
              />
            ))}

            {data.members.length === 0 && (
              <tr>
                <td colSpan={window.length + 1} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                  Nobody on this team yet — capacity is what its members are contracted for.
                </td>
              </tr>
            )}

            {/* The emphasis rule the design puts above the total: everything above
                it is a person, everything below is arithmetic on them. */}
            <tr className="bg-band/40 border-t-2 border-gray-700 dark:border-gray-300">
              <th scope="row" className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
                Team
              </th>
              {indices.map((index) => (
                <CapacityCell
                  key={data.sprints[index].sprint_id}
                  breakdown={data.team[index] ?? null}
                  label={`Team, ${data.sprints[index].label}`}
                  normalDayHours={data.normal_day_hours}
                  expanded={expanded === `team:${index}`}
                  onToggle={() => toggle(`team:${index}`)}
                  emphasis
                />
              ))}
            </tr>

            {data.projects.map((project) => (
              <ProjectRow key={project.project_id} project={project} indices={indices} />
            ))}

            {notCounted.length > 0 && (
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={window.length + 1}
                  className="px-4 pt-5 pb-1 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  Not counted towards capacity
                </th>
              </tr>
            )}
            {notCounted.map((member) => (
              <MemberRow
                key={member.member_id}
                member={member}
                sprints={data.sprints}
                indices={indices}
                normalDayHours={data.normal_day_hours}
                expanded={expanded}
                onToggle={toggle}
                muted
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface MemberRowProps {
  readonly member: MemberCapacityRow
  readonly sprints: readonly CapacitySprint[]
  readonly indices: readonly number[]
  readonly normalDayHours: number
  readonly expanded: string | null
  readonly onToggle: (key: string) => void
  /** Greyed: this member's numbers are shown but not in the Team total. */
  readonly muted?: boolean
}

function MemberRow({ member, sprints, indices, normalDayHours, expanded, onToggle, muted = false }: MemberRowProps) {
  return (
    <tr className={`hover:bg-band/20 ${muted ? 'opacity-60' : ''}`}>
      <th
        scope="row"
        className={`px-4 py-2 text-left text-sm font-medium ${
          muted ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {member.name}
      </th>
      {indices.map((index) => (
        <CapacityCell
          key={sprints[index].sprint_id}
          breakdown={member.cells[index] ?? null}
          label={`${member.name}, ${sprints[index].label}`}
          normalDayHours={normalDayHours}
          expanded={expanded === `${member.member_id}:${index}`}
          onToggle={() => onToggle(`${member.member_id}:${index}`)}
        />
      ))}
    </tr>
  )
}

interface ProjectRowProps {
  readonly project: ProjectCapacityRow
  readonly indices: readonly number[]
}

/**
 * What the team's capacity is worth to one project (§6.4).
 *
 * A `factor` project shows the **integer a push would write** — the rounded
 * value, not the float behind it, because a preview that shows the unrounded
 * number lies about its own outcome. A `manual` project shows the same figure
 * marked as a reference: nothing flows into it until someone changes that.
 */
function ProjectRow({ project, indices }: ProjectRowProps) {
  const derived = project.available_source === 'factor'
  return (
    <tr className="bg-band/20">
      <th scope="row" className="px-4 py-2 text-left">
        <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">{project.name}</span>
        <span className="block text-[11px] text-gray-400 dark:text-gray-500">
          {project.share_pct}% · {derived ? `${project.units_per_pd} ${project.effort_unit}/PD` : 'manual'}
        </span>
      </th>
      {indices.map((index) => {
        const personDays = project.person_days[index]
        const units = project.units[index]
        const proposed = project.proposed_available[index]
        return (
          <td key={index} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
            {personDays === null || personDays === undefined ? (
              <span className="text-gray-300 dark:text-gray-600">—</span>
            ) : (
              <>
                <span className="block">{fmt1(personDays)} PD</span>
                <span className="block text-gray-400 dark:text-gray-500">
                  {derived
                    ? `→ ${proposed} ${project.effort_unit}`
                    : `≈ ${fmt1(units ?? 0)} ${project.effort_unit} · manual`}
                </span>
              </>
            )}
          </td>
        )
      })}
    </tr>
  )
}
