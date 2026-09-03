import { useState } from 'react'
import { AbsencesView } from '@/components/AbsencesView'
import { TeamCapacityView } from '@/components/TeamCapacityView'
import { TeamMembersView } from '@/components/TeamMembersView'
import { TeamProjectsView } from '@/components/TeamProjectsView'
import { WorkingDaysView } from '@/components/WorkingDaysView'
import { useTeamRead } from '@/hooks/useTeams'
import { useUiStore } from '@/stores/uiStore'

interface Props {
  readonly teamId: string
}

type ViewId = 'members' | 'working-days' | 'absences' | 'meetings' | 'capacity' | 'projects'

interface TeamView {
  readonly id: ViewId
  readonly label: string
  /** Built by a later step. Listed, so the rail is the whole area, but never a dead click. */
  readonly pending?: boolean
}

/** The six views of a team, in the order the design fixes them. */
const VIEWS: readonly TeamView[] = [
  { id: 'members', label: 'Members' },
  { id: 'working-days', label: 'Working days' },
  { id: 'absences', label: 'Absences' },
  { id: 'meetings', label: 'Meetings', pending: true },
  { id: 'capacity', label: 'Capacity' },
  { id: 'projects', label: 'Projects' },
]

/**
 * The team workspace: a left rail and one view (teams.md §7.0; design §2).
 *
 * A rail rather than a tab strip. Six destinations is past what a tab row reads
 * well at, and the rail carries what a tab row has nowhere to put: which team you
 * are in, how many people are on it, and the way back out. It is the shell for
 * every team view, so all six are listed from the start — Meetings is marked as
 * not built yet rather than omitted, because a rail that grows items as steps
 * land would keep moving under people who had learned it.
 *
 * There is deliberately **no edit-mode button** anywhere here: team writes take
 * no lock (§4.1), and the header's control is gated on `activeProjectId`, which
 * is null while a team is open.
 */
export const TeamPage: React.FC<Props> = ({ teamId }) => {
  const { data } = useTeamRead(teamId)
  const setActiveProject = useUiStore((s) => s.setActiveProject)
  const [view, setView] = useState<ViewId>('members')
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null)

  const team = data?.team
  const memberCount = team?.member_count ?? 0

  return (
    <div className="flex flex-1 min-h-0">
      <nav
        aria-label="Team views"
        className="w-[172px] shrink-0 border-r border-white/60 dark:border-white/10 px-3 py-4 overflow-y-auto"
      >
        <button
          onClick={() => setActiveProject(null)}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600"
        >
          ◄ All teams
        </button>

        <div className="mt-4 px-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 break-words">
            {team?.name ?? 'Team'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {memberCount === 1 ? '1 member' : `${memberCount} members`}
          </p>
        </div>

        <ul className="mt-4 space-y-0.5">
          {VIEWS.map((item) => {
            const active = item.id === view
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={item.pending}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setView(item.id)}
                  title={item.pending ? 'Not built yet' : undefined}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                    active
                      ? 'bg-band shadow-soft-inset text-blue-600 dark:text-blue-400 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-band/60'
                  } ${item.pending ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : ''}`}
                >
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {view === 'members' && (
          <TeamMembersView
            teamId={teamId}
            onOpenWorkingDays={(memberId) => {
              // Hours and focus are read-only in Members; this is where they are
              // actually set, so the chip navigates instead of editing (§7.2).
              setFocusMemberId(memberId)
              setView('working-days')
            }}
          />
        )}
        {view === 'working-days' && <WorkingDaysView teamId={teamId} focusMemberId={focusMemberId} />}
        {view === 'absences' && <AbsencesView teamId={teamId} />}
        {/* The sprint calendar comes from the anchor project, so a team with none
            is sent to the view that gives it one rather than shown an empty grid. */}
        {view === 'capacity' && (
          <TeamCapacityView teamId={teamId} onOpenProjects={() => setView('projects')} />
        )}
        {view === 'projects' && <TeamProjectsView teamId={teamId} />}
      </div>
    </div>
  )
}
