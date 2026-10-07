import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AssignProjectModal } from '../AssignProjectModal'
import { useProjects } from '@/hooks/useProjects'
import { useAssignProject } from '@/hooks/useTeamProjects'
import { useTeams } from '@/hooks/useTeams'
import type { MemberLoad, Project, TeamAssignment } from '@/types'

vi.mock('@/hooks/useProjects')
vi.mock('@/hooks/useTeamProjects')
vi.mock('@/hooks/useTeams')
vi.mock('@/hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({
    data: [
      { system_id: 'm-1', name: 'Anna', counts_towards_capacity: true },
      { system_id: 'm-2', name: 'Bruno', counts_towards_capacity: true },
      { system_id: 'm-3', name: 'Pia', counts_towards_capacity: false },
    ],
  }),
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const project = {
  system_id: 'p-1',
  name: 'ISK Portal',
  effort_unit: 'pts',
} as unknown as Project

const defaultProps = {
  open: true,
  teamId: 't-1',
  assigned: [],
  onClose: vi.fn(),
}

/** The 409 the backend raises when the two calendars do not line up (§6.8). */
const misaligned = {
  response: {
    status: 409,
    data: {
      detail: {
        error: 'SPRINT_DATES_MISALIGNED',
        message:
          "'ISK Portal' cannot join this team yet: its sprint dates do not match the projects already served.",
        conflicts: [
          {
            sprint_number: 2,
            project_name: 'ISK Portal',
            pi_name: 'PI-7',
            start_date: '2026-04-06',
            end_date: '2026-04-17',
            other_project_id: 'p-2',
            other_project_name: 'Data Exchange',
            other_pi_name: 'PI-7',
            other_start_date: '2026-04-13',
            other_end_date: '2026-04-24',
          },
        ],
      },
    },
  },
}

const load = (member_id: string, name: string, remaining_days = 5): MemberLoad => ({
  member_id, name, share_pct: 0, days_per_week: 0, contracted_days: 5, remaining_days,
})

const mockLoads = (loads: MemberLoad[]) =>
  vi.mocked(useTeams).mockReturnValue({
    data: [{ system_id: 't-1', member_loads: loads }],
  } as unknown as ReturnType<typeof useTeams>)

/** Billing: Anna fully, Bruno 2 days a week. */
const billing = {
  project_id: 'p-2',
  project_name: 'Billing',
  share_pct: 100,
  share_days: null,
  all_members: false,
  member_ids: ['m-1', 'm-2'],
  member_shares: [{ member_id: 'm-2', share_pct: null, share_days: 2 }],
  remaining: false,
} as unknown as TeamAssignment

beforeEach(() => {
  vi.clearAllMocks()
  mockLoads([load('m-1', 'Anna Fischer'), load('m-2', 'Bruno Weber')])
  vi.mocked(useProjects).mockReturnValue({ data: [project] } as ReturnType<typeof useProjects>)
  vi.mocked(useAssignProject).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useAssignProject>)
})

async function submitWith(err: unknown) {
  mutateAsync.mockRejectedValue(err)
  render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
  await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))
}

describe('AssignProjectModal', () => {
  it('shows the backend’s reason when the sprint calendars disagree', async () => {
    // Retrying can never fix misalignment, so "please try again" is the one
    // thing this must not say.
    await submitWith(misaligned)

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match the projects/i)
    expect(screen.queryByText(/please try again/i)).not.toBeInTheDocument()
  })

  it('names the sprints that have to move', async () => {
    await submitWith(misaligned)

    const conflict = await screen.findByText(/Sprint 2 of PI-7 runs/)
    expect(conflict).toHaveTextContent('2026-04-06')
    expect(conflict).toHaveTextContent('Data Exchange')
    expect(conflict).toHaveTextContent('2026-04-24')
  })

  it('falls back to try-again for a failure it cannot explain', async () => {
    await submitWith(new Error('network'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/please try again/i)
  })

  it('calls the choice Resource allocation', () => {
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    expect(screen.getByRole('group', { name: 'Resource allocation' })).toBeInTheDocument()
  })

  it('gives each specific member a share of their own, starting at 100%', async () => {
    mutateAsync.mockResolvedValue({})
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('radio', { name: 'Specific members' }))
    // Ticking nobody is allowed but said out loud: the project would get 0 PD.
    expect(screen.getByRole('status')).toHaveTextContent(/no capacity at all/)
    // Someone tracked for absences only brings nothing to count.
    expect(screen.getByRole('checkbox', { name: /Pia/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anna' }))
    expect(screen.getByLabelText("Anna's share")).toHaveValue(100)
    // One place to type a share: no second one for the group.
    expect(screen.queryByLabelText('Share of the team')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'p-1', all_members: false, member_ids: ['m-1'], share_pct: 100, member_shares: [],
        }),
      ),
    )
  })

  it('stores one share on the assignment when every member has the same', async () => {
    mutateAsync.mockResolvedValue({})
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('radio', { name: 'Specific members' }))
    for (const name of ['Anna', 'Bruno']) {
      await userEvent.click(screen.getByRole('checkbox', { name }))
      await userEvent.clear(screen.getByLabelText(`${name}'s share`))
      await userEvent.type(screen.getByLabelText(`${name}'s share`), '60')
    }
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      share_pct: 60, member_ids: ['m-1', 'm-2'], member_shares: [],
    })
  })

  it('keeps a member who differs as a share of their own', async () => {
    mutateAsync.mockResolvedValue({})
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('radio', { name: 'Specific members' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anna' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bruno' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: "Bruno's share unit" }), 'days')
    await userEvent.clear(screen.getByLabelText("Bruno's share"))
    await userEvent.type(screen.getByLabelText("Bruno's share"), '2')
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      share_pct: 100,
      member_ids: ['m-1', 'm-2'],
      member_shares: [{ member_id: 'm-2', share_days: 2 }],
    })
  })

  it('asks for the share of a ticked member left empty', async () => {
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('radio', { name: 'Specific members' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anna' }))
    await userEvent.clear(screen.getByLabelText("Anna's share"))
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Give Anna a share, or untick them.')
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('takes the remaining capacity, which is the whole team while nothing else is assigned', async () => {
    mutateAsync.mockResolvedValue({})
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('radio', { name: 'Remaining capacity' }))
    expect(screen.getByRole('status')).toHaveTextContent(/Today this is the whole team/)
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const body = mutateAsync.mock.calls[0][0]
    expect(body).toMatchObject({ project_id: 'p-1', remaining: true })
    for (const field of ['share_pct', 'share_days', 'all_members', 'member_ids', 'member_shares']) {
      expect(body).not.toHaveProperty(field)
    }
  })

  it('shows what the other projects leave of each member', async () => {
    mockLoads([load('m-1', 'Anna Fischer', 0), load('m-2', 'Bruno Weber', 3)])
    render(<AssignProjectModal {...defaultProps} assigned={[billing]} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('radio', { name: 'Remaining capacity' }))

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Today ≈ 3 d/wk')
    expect(status).toHaveTextContent('Bruno 3 of 5')
    expect(status).toHaveTextContent('Anna is fully booked and gives nothing.')
  })

  it('is disabled while another project takes the remaining capacity', () => {
    const search = { ...billing, project_id: 'p-3', project_name: 'Search', remaining: true }
    render(<AssignProjectModal {...defaultProps} assigned={[billing, search]} />, { wrapper: makeWrapper() })

    expect(screen.getByRole('radio', { name: 'Remaining capacity' })).toBeDisabled()
    expect(screen.getByText('Search already takes the remaining capacity. Only one project can.')).toBeInTheDocument()
  })

  it('is disabled when nobody has anything left', () => {
    const everyone = { ...billing, all_members: true, member_ids: [], member_shares: [] }
    render(<AssignProjectModal {...defaultProps} assigned={[everyone]} />, { wrapper: makeWrapper() })

    expect(screen.getByRole('radio', { name: 'Remaining capacity' })).toBeDisabled()
    expect(screen.getByText(/Nobody has capacity left/)).toBeInTheDocument()
  })

  it('shows the backend’s reason when the remaining capacity is taken meanwhile', async () => {
    mutateAsync.mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            error: 'REMAINING_TAKEN',
            message: "'Search' already takes the remaining capacity.",
          },
        },
      },
    })
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('radio', { name: 'Remaining capacity' }))
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent("'Search' already takes")
  })

  it('takes the share in days a week, and a member share of their own', async () => {
    mutateAsync.mockResolvedValue({})
    render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Share of the team unit' }), 'days')
    await userEvent.clear(screen.getByLabelText('Share of the team'))
    await userEvent.type(screen.getByLabelText('Share of the team'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Give some members a different share' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: "Anna's share unit" }), 'days')
    await userEvent.type(screen.getByLabelText("Anna's share"), '2.5')
    // Someone tracked for absences only has no share to give.
    expect(screen.queryByLabelText("Pia's share")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const body = mutateAsync.mock.calls[0][0]
    expect(body).toMatchObject({
      share_days: 1,
      member_shares: [{ member_id: 'm-1', share_days: 2.5 }],
    })
    expect(body).not.toHaveProperty('share_pct')
  })

  it('assigns the project when the API accepts it', async () => {
    mutateAsync.mockResolvedValue({})
    const onClose = vi.fn()
    render(<AssignProjectModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p-1' })),
    )
    expect(onClose).toHaveBeenCalled()
  })
})
