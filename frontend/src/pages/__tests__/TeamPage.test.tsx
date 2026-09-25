import { vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeamPage } from '../TeamPage'
import { useTeamRead } from '@/hooks/useTeams'

vi.mock('@/hooks/useTeams', () => ({ useTeamRead: vi.fn() }))
vi.mock('@/components/TeamMembersView', () => ({ TeamMembersView: () => <div>members view</div> }))
vi.mock('@/components/WorkingDaysView', () => ({ WorkingDaysView: () => <div>working days view</div> }))
vi.mock('@/components/AbsencesView', () => ({ AbsencesView: () => <div>absences view</div> }))
vi.mock('@/components/MeetingsView', () => ({ MeetingsView: () => <div>meetings view</div> }))
vi.mock('@/components/TeamCapacityView', () => ({ TeamCapacityView: () => <div>capacity view</div> }))
vi.mock('@/components/TeamProjectsView', () => ({ TeamProjectsView: () => <div>projects view</div> }))
vi.mock('@/components/AchievementView', () => ({
  AchievementView: ({ teamId, onOpenProjects }: { teamId: string; onOpenProjects: () => void }) => (
    <div>
      achievement view for {teamId}
      <button onClick={onOpenProjects}>to projects</button>
    </div>
  ),
}))

describe('TeamPage rail', () => {
  beforeEach(() => {
    vi.mocked(useTeamRead).mockReturnValue({
      data: { team: { name: 'Platform', member_count: 3 } },
    } as unknown as ReturnType<typeof useTeamRead>)
  })

  it('lists Achievement between Capacity and Projects', () => {
    render(<TeamPage teamId="t-1" />)

    const rail = within(screen.getByRole('navigation', { name: 'Team views' }))
    const labels = rail.getAllByRole('listitem').map((item) => item.textContent)
    expect(labels).toEqual([
      'Members',
      'Working days',
      'Absences',
      'Meetings',
      'Capacity',
      'Achievement',
      'Projects',
    ])
  })

  it('opens the Achievement view, which can send the reader to Projects', async () => {
    render(<TeamPage teamId="t-1" />)

    const entry = screen.getByRole('button', { name: 'Achievement' })
    await userEvent.click(entry)
    expect(entry).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('achievement view for t-1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'to projects' }))
    expect(screen.getByText('projects view')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-current', 'page')
  })
})
