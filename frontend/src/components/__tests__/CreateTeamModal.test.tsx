import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateTeamModal } from '../CreateTeamModal'
import * as teamsService from '@/services/teams'

vi.mock('@/services/teams', async (importOriginal) => {
  const actual = await importOriginal<typeof teamsService>()
  return {
    ...actual,
    teamsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  }
})

const mockTeams = vi.mocked(teamsService.teamsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const httpError = (status: number, detail: unknown) => ({ response: { status, data: { detail } } })

describe('CreateTeamModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockTeams.list = vi.fn().mockResolvedValue([])
  })

  it('renders when open', () => {
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New Team')).toBeInTheDocument()
  })

  it('requires a name', async () => {
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /create team/i }))
    await waitFor(() => expect(screen.getByText('Name is required')).toBeInTheDocument())
    expect(mockTeams.create).not.toHaveBeenCalled()
  })

  it('creates a team, defaulting the day length to 8 hours', async () => {
    mockTeams.create = vi.fn().mockResolvedValue({ system_id: 't-1', name: 'Platform' })
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform')
    await userEvent.click(screen.getByRole('button', { name: /create team/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockTeams.create).toHaveBeenCalledWith({
      name: 'Platform',
      description: null,
      normal_day_hours: 8,
    })
  })

  it('sends an edited hours-per-day', async () => {
    mockTeams.create = vi.fn().mockResolvedValue({ system_id: 't-1', name: 'Platform' })
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform')
    await userEvent.clear(screen.getByLabelText(/hours per day/i))
    await userEvent.type(screen.getByLabelText(/hours per day/i), '7.5')
    await userEvent.click(screen.getByRole('button', { name: /create team/i }))

    await waitFor(() =>
      expect(mockTeams.create).toHaveBeenCalledWith(
        expect.objectContaining({ normal_day_hours: 7.5 }),
      ),
    )
  })

  it('rejects an out-of-range day length before calling the API', async () => {
    mockTeams.create = vi.fn()
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform')
    await userEvent.clear(screen.getByLabelText(/hours per day/i))
    await userEvent.type(screen.getByLabelText(/hours per day/i), '30')
    await userEvent.click(screen.getByRole('button', { name: /create team/i }))

    expect(await screen.findByText('Must be between 1 and 24 hours')).toBeInTheDocument()
    expect(mockTeams.create).not.toHaveBeenCalled()
  })

  it('reports a taken name on the name field', async () => {
    mockTeams.create = vi.fn().mockRejectedValue(
      httpError(409, { error: 'TEAM_NAME_TAKEN', message: "A team named 'Platform' already exists" }),
    )
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform')
    await userEvent.click(screen.getByRole('button', { name: /create team/i }))

    expect(await screen.findByText('A team with this name already exists')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports the team limit in the words the server used', async () => {
    mockTeams.create = vi.fn().mockRejectedValue(
      httpError(409, {
        error: 'TEAM_LIMIT_REACHED',
        message: 'An instance holds at most 50 teams.',
      }),
    )
    render(<CreateTeamModal open onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform')
    await userEvent.click(screen.getByRole('button', { name: /create team/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('An instance holds at most 50 teams.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
