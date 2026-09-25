import { vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditAssignmentModal } from '../EditAssignmentModal'
import { useUpdateAssignment } from '@/hooks/useTeamProjects'
import { achievementApi } from '@/services/achievement'
import type { ProjectVelocity, TeamAssignment } from '@/types'

vi.mock('@/hooks/useTeamProjects')
vi.mock('@/services/achievement', () => ({
  achievementApi: { get: vi.fn(), velocity: vi.fn() },
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()
const onClose = vi.fn()

const assignment = {
  system_id: 'a-1',
  team_id: 't-1',
  project_id: 'p-1',
  project_name: 'ISK Portal',
  effort_unit: 'pts',
  share_pct: 60,
  available_source: 'factor',
  units_per_pd: 1.5,
  etag: 'etag-1',
} as unknown as TeamAssignment

const sprint = (n: number) => ({
  label: `S${n}`,
  start_date: '2026-01-05',
  end_date: '2026-01-16',
  achieved: 17,
  pd_given: 12,
})

const measured = (overrides: Partial<ProjectVelocity> = {}): ProjectVelocity => ({
  project_id: 'p-1',
  effort_unit: 'pts',
  units_per_pd: 1.5,
  sprints_requested: 3,
  sprints: [sprint(1), sprint(2), sprint(3)],
  velocity: 1.41666,
  ...overrides,
})

const renderModal = (props: Partial<React.ComponentProps<typeof EditAssignmentModal>> = {}) =>
  render(
    <EditAssignmentModal open teamId="t-1" assignment={assignment} onClose={onClose} {...props} />,
    { wrapper: makeWrapper() },
  )

const factorInput = () => screen.getByRole('spinbutton', { name: /pts per person-day/i })

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue({})
  vi.mocked(useUpdateAssignment).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateAssignment>)
  vi.mocked(achievementApi.velocity).mockResolvedValue(measured())
})

describe('EditAssignmentModal', () => {
  it('renders the assignment’s current values', async () => {
    renderModal()
    await screen.findByRole('group', { name: /measured velocity/i })
    expect(screen.getByRole('dialog', { name: 'ISK Portal' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /share of the team/i })).toHaveValue(60)
    expect(screen.getByRole('radio', { name: /derived from the team/i })).toBeChecked()
    expect(factorInput()).toHaveValue(1.5)
  })

  it('saves the typed factor', async () => {
    renderModal()
    await screen.findByRole('group', { name: /measured velocity/i })
    await userEvent.clear(factorInput())
    await userEvent.type(factorInput(), '1.8')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      projectId: 'p-1',
      etag: 'etag-1',
      body: { share_pct: 60, available_source: 'factor', units_per_pd: 1.8 },
    })
    expect(onClose).toHaveBeenCalled()
  })

  describe('the measured velocity suggestion (§6.3)', () => {
    it('shows the velocity with the project’s unit and the closed sprints used', async () => {
      renderModal()
      const block = await screen.findByRole('group', { name: /measured velocity/i })
      expect(block).toHaveTextContent('Last 3 closed sprints: 1.42 pts/PD')
      expect(screen.getByRole('button', { name: /^use this value$/i })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: /closed sprints to measure/i })).toHaveValue('3')
      expect(achievementApi.velocity).toHaveBeenCalledWith('t-1', 'p-1', 3)
    })

    it('says so when fewer closed sprints exist than were asked for', async () => {
      vi.mocked(achievementApi.velocity).mockResolvedValue(
        measured({ sprints: [sprint(1), sprint(2)], velocity: 1.25 }),
      )
      renderModal()
      const block = await screen.findByRole('group', { name: /measured velocity/i })
      expect(block).toHaveTextContent('Last 2 closed sprints (of 3 asked): 1.25 pts/PD')
    })

    it('fills the input on “Use this value” without saving or changing the source', async () => {
      renderModal()
      await userEvent.click(await screen.findByRole('button', { name: /^use this value$/i }))

      expect(factorInput()).toHaveValue(1.42)
      expect(screen.getByRole('radio', { name: /derived from the team/i })).toBeChecked()
      expect(mutateAsync).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('sends the filled value when the user then saves', async () => {
      renderModal()
      await userEvent.click(await screen.findByRole('button', { name: /^use this value$/i }))
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
      expect(mutateAsync).toHaveBeenCalledWith({
        projectId: 'p-1',
        etag: 'etag-1',
        body: { share_pct: 60, available_source: 'factor', units_per_pd: 1.42 },
      })
    })

    it('shows nothing when there is no closed sprint to measure', async () => {
      vi.mocked(achievementApi.velocity).mockResolvedValue(
        measured({ sprints: [], velocity: null }),
      )
      renderModal()
      await waitFor(() => expect(achievementApi.velocity).toHaveBeenCalled())
      // Let the resolved query render before asserting on its absence.
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

      expect(screen.queryByRole('group', { name: /measured velocity/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /use this value/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/pts\/PD/)).not.toBeInTheDocument()
      expect(factorInput()).toHaveValue(1.5)
    })

    it('refetches with the new sprint count when it is changed', async () => {
      renderModal()
      const select = await screen.findByRole('combobox', { name: /closed sprints to measure/i })
      vi.mocked(achievementApi.velocity).mockResolvedValue(
        measured({
          sprints_requested: 5,
          sprints: [sprint(1), sprint(2), sprint(3), sprint(4), sprint(5)],
          velocity: 1.6,
        }),
      )
      await userEvent.selectOptions(select, '5')

      await waitFor(() => expect(achievementApi.velocity).toHaveBeenLastCalledWith('t-1', 'p-1', 5))
      await waitFor(() =>
        expect(screen.getByRole('group', { name: /measured velocity/i })).toHaveTextContent(
          'Last 5 closed sprints: 1.60 pts/PD',
        ),
      )
    })

    it('does not fetch while the modal is closed', () => {
      renderModal({ open: false })
      expect(achievementApi.velocity).not.toHaveBeenCalled()
    })

    it('does not fetch while Available is typed by hand, and does once the factor is chosen', async () => {
      renderModal({ assignment: { ...assignment, available_source: 'manual' } })
      expect(achievementApi.velocity).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('radio', { name: /derived from the team/i }))
      expect(await screen.findByRole('group', { name: /measured velocity/i })).toBeInTheDocument()
      expect(achievementApi.velocity).toHaveBeenCalledWith('t-1', 'p-1', 3)
    })
  })
})
