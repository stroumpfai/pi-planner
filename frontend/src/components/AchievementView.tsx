import { useCallback, useEffect, useMemo, useState } from 'react'
import { TimelineMinimap } from '@/components/TimelineMinimap'
import { WorkItemLink } from '@/components/WorkItemLink'
import { useTeamAchievement } from '@/hooks/useTeamAchievement'
import type { AchievedItem, CapacitySprint, ProjectAchievementRow, TeamAchievement } from '@/types'
import { monthlyAchievedPd } from '@/utils/achievementMinimap'
import {
  bestSprintIndex,
  frameMonthFor,
  sprintOffsetFor,
  windowHoldsMonth,
} from '@/utils/capacityMinimap'
import { COMPACT_SELECT } from '@/utils/compactSelect'
import { toInputDate } from '@/utils/dates'
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
  /** Send the reader to Projects — where the calendar and every factor are set. */
  readonly onOpenProjects: () => void
}

/** Six columns at a time, exactly as the Capacity view (teams.md §7.0.1). */
const COLUMNS = 6
/** The months the minimap's frame covers — fixed, as in the Capacity view. */
const FRAME_MONTHS = 6
const JUMP_BACK_MONTHS = 12
const JUMP_MONTHS = 36

const DASH = <span className="text-gray-300 dark:text-gray-600">—</span>

/** Points as they are, without float noise: 21 reads "21", 2.5 reads "2.5". */
const fmtPoints = (value: number): string => String(Math.round(value * 100) / 100)
const fmtVelocity = (value: number): string => value.toFixed(2)
const fmtPercent = (ratio: number): string => `${Math.round(ratio * 100)}%`

const typeLabel = (type: AchievedItem['item_type']): string => (type === 'bug' ? 'bugs' : 'stories')

/**
 * What a team achieved, per sprint (spec/team-achievement.md §5).
 *
 * The Capacity view's counterpart: the same columns from the anchor project's
 * calendar, the same minimap, the other half of the question. Per project it
 * reads Committed (by placement), Achieved (by completion date), the PD the
 * project was given and the velocity those make; the team block converts the
 * factor projects into person-days and sets them against what was available.
 *
 * Unknown is never zero here: an undated sprint, a project with no done State, a
 * Committed figure with no matching sprint all read "—".
 */
export function AchievementView({ teamId, onOpenProjects }: Props) {
  const { data, isLoading, isError } = useTeamAchievement(teamId)
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Window and minimap state follow the Capacity view one for one (§7.4, §7.6):
  // opening on today, re-anchoring once the sprints arrive, and pinning a month
  // the reader named while the table still reaches it.
  const [minimapStart, setMinimapStart] = useState<YearMonth>(() => monthOf(todayIso()))
  const [stripMonths, setStripMonths] = useState(DEFAULT_STRIP_MONTHS)
  const [named, setNamed] = useState<YearMonth | null>(null)

  const sprints = useMemo(() => data?.sprints ?? [], [data])
  const months = useMemo(() => monthsFrom(minimapStart, stripMonths), [minimapStart, stripMonths])

  // The bars: achieved PD per month, a straddling sprint split by its days (§5.2).
  const density = useMemo(
    () => monthlyAchievedPd(sprints, data?.team.achieved_pd ?? [], months),
    [sprints, data, months],
  )

  const frameStart = useMemo(() => {
    const windowed = sprints.slice(offset, offset + COLUMNS)
    if (named && windowHoldsMonth(windowed, named)) return named
    return frameMonthFor(sprints, offset, monthOf(todayIso()))
  }, [sprints, offset, named])

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

  useEffect(() => {
    setMinimapStart((current) => stripStartFor(current, frameStart, stripMonths, FRAME_MONTHS))
  }, [frameStart, stripMonths])

  if (isLoading) {
    return <p className="p-6 text-sm text-gray-400 dark:text-gray-500">Computing achievement…</p>
  }

  if (isError) {
    return (
      <div className="p-6">
        <div role="alert" className="text-center py-16 text-gray-500 dark:text-gray-400 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">The achievement report could not be loaded. Try again in a moment.</p>
        </div>
      </div>
    )
  }

  if (!data || data.anchor_project_id === null) {
    return (
      <div className="p-6">
        <div className="text-center py-16 text-gray-400 dark:text-gray-500 bg-canvas shadow-soft rounded-xl">
          <p className="text-sm">
            This team serves no project yet, so it has no sprint calendar to measure against. Assign a
            project to give the team a sprint calendar.
          </p>
          <button
            type="button"
            onClick={onOpenProjects}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
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

  const excluded = data.projects.filter((p) => !p.in_pd_total)
  const hasTotal = data.projects.some((p) => p.in_pd_total)

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
          Achieved counts what was completed inside a sprint&rsquo;s dates. Click an Achieved figure to
          see the items behind it.
        </p>
      </div>

      {/* The teams.md §7.4 strip a third time: a bar is achieved PD in that month. */}
      <div className="bg-canvas shadow-soft rounded-xl p-4">
        <TimelineMinimap
          windowStart={minimapStart}
          frameStart={frameStart}
          frameMonths={FRAME_MONTHS}
          density={density}
          describeDensity={(value) =>
            value > 0 ? `${fmt1(value)} person-days achieved` : 'nothing achieved'
          }
          onFrameStart={showMonth}
          stripMonths={stripMonths}
          onStripMonths={setStripMonths}
          hint={
            <>
              <p>Achieved</p>
              <p className="text-gray-500 dark:text-gray-400">person-days</p>
            </>
          }
        >
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
        <table className="w-full text-sm" aria-label="Achievement per sprint">
          <thead>
            <tr className="bg-band/40">
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 w-48">
                Project
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

          {data.projects.map((project) => (
            <ProjectBlock
              key={project.project_id}
              project={project}
              sprints={data.sprints}
              indices={indices}
              expanded={expanded}
              onToggle={toggle}
            />
          ))}

          {hasTotal && <TeamBlock team={data.team} indices={indices} sprints={data.sprints} />}
        </table>
      </div>

      <Notes data={data} excluded={excluded} hasTotal={hasTotal} onOpenProjects={onOpenProjects} />
    </div>
  )
}

interface ProjectBlockProps {
  readonly project: ProjectAchievementRow
  readonly sprints: readonly CapacitySprint[]
  readonly indices: readonly number[]
  readonly expanded: string | null
  readonly onToggle: (key: string) => void
}

/** One project's four rows, in its own unit — always computable, no factor needed (§5.3). */
function ProjectBlock({ project, sprints, indices, expanded, onToggle }: ProjectBlockProps) {
  const unit = project.effort_unit
  const valueCell = (value: number | null | undefined, index: number, render: (v: number) => string) => (
    <td key={index} className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200">
      {value === null || value === undefined ? DASH : render(value)}
    </td>
  )

  return (
    <tbody aria-label={project.name} className="divide-y divide-white/60 dark:divide-white/5">
      <tr className="bg-band/20">
        <th
          scope="rowgroup"
          colSpan={indices.length + 1}
          className="px-4 pt-4 pb-1.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          {project.name}
          <span className="ml-3 text-xs font-normal text-gray-500 dark:text-gray-400">
            share {project.share_pct}%
            {!project.in_pd_total && ' · manual, not in the PD total'}
          </span>
        </th>
      </tr>
      <tr className="hover:bg-band/20">
        <th scope="row" className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300">
          Committed ({unit})
        </th>
        {indices.map((index) => valueCell(project.committed[index], index, fmtPoints))}
      </tr>
      <tr className="hover:bg-band/20">
        <th scope="row" className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300">
          Achieved ({unit})
        </th>
        {indices.map((index) => {
          const key = `${project.project_id}:${index}`
          return (
            <AchievedCell
              key={index}
              project={project}
              value={project.achieved[index]}
              items={project.achieved_items[index] ?? []}
              sprintLabel={sprints[index].label}
              listId={`achieved-${project.project_id}-${index}`}
              expanded={expanded === key}
              onToggle={() => onToggle(key)}
            />
          )
        })}
      </tr>
      <tr className="hover:bg-band/20">
        <th scope="row" className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300">
          PD given
        </th>
        {indices.map((index) => valueCell(project.pd_given[index], index, fmt1))}
      </tr>
      <tr className="hover:bg-band/20">
        <th scope="row" className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300">
          Velocity ({unit}/PD)
        </th>
        {indices.map((index) =>
          valueCell(project.velocity[index], index, (v) => `${fmtVelocity(v)} ${unit}/PD`),
        )}
      </tr>
    </tbody>
  )
}

interface AchievedCellProps {
  readonly project: ProjectAchievementRow
  readonly value: number | null | undefined
  readonly items: readonly AchievedItem[]
  readonly sprintLabel: string
  /** The id of the expanded list, for `aria-controls`. */
  readonly listId: string
  readonly expanded: boolean
  readonly onToggle: () => void
}

/**
 * An Achieved figure, and the stories and bugs behind it (§5.4) — a surprising
 * number is one click from its cause.
 */
function AchievedCell({ project, value, items, sprintLabel: label, listId, expanded, onToggle }: AchievedCellProps) {
  if (value === null || value === undefined) {
    return <td className="px-3 py-1.5 text-xs">{DASH}</td>
  }
  if (items.length === 0) {
    return <td className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200">{fmtPoints(value)}</td>
  }

  return (
    <td className="px-3 py-1.5 align-top">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-label={`${project.name} achieved, ${label}: ${fmtPoints(value)} ${project.effort_unit}`}
        className={`w-full text-left rounded-lg px-2 py-0.5 -mx-2 text-xs font-medium text-gray-900 dark:text-gray-100 hover:bg-band/60 ${
          expanded ? 'bg-band shadow-soft-inset' : ''
        }`}
      >
        {fmtPoints(value)}
      </button>

      {expanded && (
        <ul
          id={listId}
          aria-label={`Items achieved by ${project.name} in ${label}`}
          className="mt-2 space-y-1 text-[11px] text-gray-600 dark:text-gray-300"
        >
          {items.map((item) => (
            <li key={item.system_id} className="group">
              <span className="flex items-center gap-1 min-w-0">
                <span className="truncate">
                  {item.id !== null ? `[${item.id}] ` : ''}
                  {item.title}
                </span>
                <WorkItemLink projectId={project.project_id} id={item.id} />
              </span>
              <span className="block text-gray-400 dark:text-gray-500">
                {item.effort === null ? 'no effort' : `${fmtPoints(item.effort)} ${project.effort_unit}`} ·{' '}
                {toInputDate(item.completed_on)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </td>
  )
}

interface TeamBlockProps {
  readonly team: TeamAchievement['team']
  readonly sprints: readonly CapacitySprint[]
  readonly indices: readonly number[]
}

/** The team rows: factor projects converted to PD, set against what was available (§5.3). */
function TeamBlock({ team, sprints, indices }: TeamBlockProps) {
  const cells = (values: readonly (number | null)[], render: (v: number) => string) =>
    indices.map((index) => {
      const value = values[index]
      return (
        <td key={sprints[index].sprint_id} className="px-3 py-1.5 text-xs font-medium text-gray-900 dark:text-gray-100">
          {value === null || value === undefined ? DASH : render(value)}
        </td>
      )
    })

  return (
    <tbody aria-label="Team" className="divide-y divide-white/60 dark:divide-white/5">
      <tr className="bg-band/40 border-t-2 border-gray-700 dark:border-gray-300">
        <th
          scope="rowgroup"
          colSpan={indices.length + 1}
          className="px-4 pt-4 pb-1.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          Team
        </th>
      </tr>
      <tr className="bg-band/20">
        <th scope="row" className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300">
          Achieved (PD)
        </th>
        {cells(team.achieved_pd, fmt1)}
      </tr>
      <tr className="bg-band/20">
        <th scope="row" className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300">
          Available (PD)
        </th>
        {cells(team.available_pd, fmt1)}
      </tr>
      <tr className="bg-band/20">
        <th
          scope="row"
          title="Achieved PD over available PD: how close reality is to the factor you typed"
          className="pl-8 pr-4 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300"
        >
          Realised (%)
        </th>
        {cells(team.realised, fmtPercent)}
      </tr>
    </tbody>
  )
}

interface NotesProps {
  readonly data: TeamAchievement
  readonly excluded: readonly ProjectAchievementRow[]
  readonly hasTotal: boolean
  readonly onOpenProjects: () => void
}

/**
 * What the table must not hide (§5.5) and why the total is what it is (§5.3).
 * Each line appears only when it has something to say.
 */
function Notes({ data, excluded, hasTotal, onOpenProjects }: NotesProps) {
  const outside = data.projects.filter((p) => p.outside_calendar_points > 0)
  const undated = data.projects.filter((p) => p.done_undated_count > 0)
  const noDone = data.projects.filter((p) => p.item_types_without_done_state.length > 0)

  const factorButton = (
    <button
      type="button"
      onClick={onOpenProjects}
      className="ml-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
    >
      Set a factor in Projects
    </button>
  )

  return (
    <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400 px-1">
      {!hasTotal && data.projects.length > 0 && (
        <p role="note">
          No team total in person-days: every project here is <em>manual</em>, and converting its points
          through a factor nobody set would claim one point is one person-day.
          {factorButton}
        </p>
      )}
      {hasTotal && excluded.length > 0 && (
        <p role="note">
          Not in the PD total: {excluded.map((p) => p.name).join(', ')} — manual, so no factor converts
          its points to person-days. Its own rows and velocity still count.
          {factorButton}
        </p>
      )}

      {outside.length > 0 && (
        <p role="note">
          Outside the calendar:{' '}
          {outside.map((p) => `${fmtPoints(p.outside_calendar_points)} ${p.effort_unit} (${p.name})`).join(', ')}{' '}
          — completed in no sprint, so counted in no column.
        </p>
      )}

      {undated.length > 0 && (
        <p role="note">
          Done but undated:{' '}
          {undated
            .map((p) => `${p.done_undated_count} ${p.done_undated_count === 1 ? 'item' : 'items'} (${p.name})`)
            .join(', ')}
          . A CSV import with a Closed Date, or editing the item, gives them a completion date.
        </p>
      )}

      {noDone.length > 0 && (
        <p role="note">
          No done State:{' '}
          {noDone
            .map((p) => `${p.name} (${p.item_types_without_done_state.map(typeLabel).join(', ')})`)
            .join('; ')}
          . Those rows read — until a State is marked done in Edit Project → Manage States.
        </p>
      )}
    </div>
  )
}
