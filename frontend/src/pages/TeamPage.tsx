import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { TeamCapacityView } from '@/components/TeamCapacityView'
import { TeamMembersView } from '@/components/TeamMembersView'
import { TeamProjectsView } from '@/components/TeamProjectsView'
import { WorkingDaysView } from '@/components/WorkingDaysView'
import { useTeamRead } from '@/hooks/useTeams'
import { useUiStore } from '@/stores/uiStore'

interface Props {
  readonly teamId: string
}

/**
 * The team workspace.
 *
 * Teams get their own local tab bar rather than living in the project shell, and
 * deliberately **no edit-lock control**: team writes take no lock (teams.md
 * §4.1), so offering "Request Edit Mode" here would contradict the design. The
 * header's button is gated on `activeProjectId`, which is null while a team is
 * open — this page must not reintroduce it.
 *
 * Absences and Meetings are the remaining tabs and arrive with the steps that
 * build them; a tab that leads nowhere is worse than one that is not there yet.
 */
export const TeamPage: React.FC<Props> = ({ teamId }) => {
  const { data } = useTeamRead(teamId)
  const setActiveProject = useUiStore((s) => s.setActiveProject)
  const [tab, setTab] = useState('members')
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 pt-6">
        <button
          onClick={() => setActiveProject(null)}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600"
        >
          ← Projects and teams
        </button>
        <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
          {data?.team.name ?? 'Team'}
        </h2>
        {data?.team.description && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{data.team.description}</p>
        )}
      </div>

      <Tabs.Root value={tab} onValueChange={setTab} className="mt-4">
        <Tabs.List className="flex border-b border-white/60 dark:border-white/10 px-6">
          <Tabs.Trigger
            value="members"
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border-b-2 border-transparent hover:text-gray-900 dark:hover:text-gray-100 data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 transition-colors"
          >
            Members
          </Tabs.Trigger>
          <Tabs.Trigger
            value="working-days"
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border-b-2 border-transparent hover:text-gray-900 dark:hover:text-gray-100 data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 transition-colors"
          >
            Working days
          </Tabs.Trigger>
          <Tabs.Trigger
            value="capacity"
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border-b-2 border-transparent hover:text-gray-900 dark:hover:text-gray-100 data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 transition-colors"
          >
            Capacity
          </Tabs.Trigger>
          <Tabs.Trigger
            value="projects"
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 border-b-2 border-transparent hover:text-gray-900 dark:hover:text-gray-100 data-[state=active]:border-blue-600 dark:data-[state=active]:border-blue-400 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400 transition-colors"
          >
            Projects
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="members">
          <TeamMembersView
            teamId={teamId}
            onOpenWorkingDays={(memberId) => {
              // A member's hours and focus are read-only in Members; this is where
              // they are actually set, so the chip navigates instead of editing.
              setFocusMemberId(memberId)
              setTab('working-days')
            }}
          />
        </Tabs.Content>

        <Tabs.Content value="working-days">
          <WorkingDaysView teamId={teamId} focusMemberId={focusMemberId} />
        </Tabs.Content>

        <Tabs.Content value="capacity">
          {/* The sprint calendar comes from the anchor project, so a team with
              none is sent to the tab that gives it one rather than shown an
              empty grid (§7.0.1). */}
          <TeamCapacityView teamId={teamId} onOpenProjects={() => setTab('projects')} />
        </Tabs.Content>

        <Tabs.Content value="projects">
          <TeamProjectsView teamId={teamId} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
