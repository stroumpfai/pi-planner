import { useState } from 'react'
import { CapacityCell } from '@/components/CapacityCell'
import { useTeamCapacity } from '@/hooks/useTeamProjects'
import type { ProjectCapacityRow } from '@/types'
import { fmt1, sprintDateRange, sprintLabel } from '@/utils/sprintLabels'

interface Props {
  readonly teamId: string
  /** Send the reader to Projects, where the sprint calendar comes from (§7.0.1). */
  readonly onOpenProjects: () => void
}

/** Six columns at a time — enough for a PI and a bit, and still readable (§7.6). */
const COLUMNS = 6

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
          onClick={() => setOffset(Math.max(0, offset - COLUMNS))}
          disabled={atStart}
          aria-label="Earlier sprints"
          className="px-3 py-1 text-sm rounded-lg bg-canvas shadow-soft-sm text-gray-600 dark:text-gray-300 disabled:opacity-30 hover:shadow-soft-hover"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setOffset(Math.min(Math.max(0, data.sprints.length - COLUMNS), offset + COLUMNS))}
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
            {data.members.map((member) => (
              <tr key={member.member_id} className="hover:bg-band/20">
                <th scope="row" className="px-4 py-2 text-left text-sm font-medium text-gray-900 dark:text-gray-100">
                  {member.name}
                </th>
                {indices.map((index) => (
                  <CapacityCell
                    key={data.sprints[index].sprint_id}
                    breakdown={member.cells[index] ?? null}
                    label={`${member.name}, ${data.sprints[index].label}`}
                    normalDayHours={data.normal_day_hours}
                    expanded={expanded === `${member.member_id}:${index}`}
                    onToggle={() => toggle(`${member.member_id}:${index}`)}
                  />
                ))}
              </tr>
            ))}

            {data.members.length === 0 && (
              <tr>
                <td colSpan={window.length + 1} className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                  Nobody on this team yet — capacity is what its members are contracted for.
                </td>
              </tr>
            )}

            <tr className="bg-band/40">
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
          </tbody>
        </table>
      </div>
    </div>
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
