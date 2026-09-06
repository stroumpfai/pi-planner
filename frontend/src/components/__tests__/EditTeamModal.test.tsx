import { vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditTeamModal } from '../EditTeamModal'
import * as apiModule from '@/services/api'
import type { Team } from '@/types'

// The axios instance is the only thing faked here: `services/teams` and `useTeams`
// run for real, because the ETag round trip they perform is what is under test.
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  }
})

// `vi.mocked` cannot see through axios's overloaded method signatures, so the
// instance is narrowed to the four calls this suite drives.
const mockApi = apiModule.api as unknown as {
  get: Mock
  post: Mock
  patch: Mock
  delete: Mock
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const team: Team = {
  system_id: 't-1',
  name: 'Platform',
  description: null,
  normal_day_hours: 8,
  member_count: 6,
  project_ids: [],
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const readResponse = (etag: string, over: Partial<Team> = {}) => ({
  data: { ...team, ...over },
  headers: { etag },
})

const httpError = (status: number, detail: unknown) => ({ response: { status, data: { detail } } })

describe('EditTeamModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockResolvedValue(readResponse('"tag-1"'))
  })

  it('prefills from the read it will write against, not from the row it was handed', async () => {
    // The list row can be minutes old. Populating from it while writing against a
    // fresh tag is what would let this save silently revert someone else (§4.2).
    mockApi.get.mockResolvedValue(readResponse('"tag-1"', { name: 'Platform Renamed' }))

    render(<EditTeamModal open team={team} onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByLabelText(/^name/i)).toHaveValue('Platform Renamed'))
    expect(screen.getByLabelText(/hours per day/i)).toHaveValue(8)
  })

  it('renames the team, sending the If-Match from the read that filled the form', async () => {
    mockApi.patch.mockResolvedValue(readResponse('"tag-2"', { name: 'Platform Core' }))

    render(<EditTeamModal open team={team} onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByLabelText(/^name/i)).toHaveValue('Platform'))
    await userEvent.clear(screen.getByLabelText(/^name/i))
    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform Core')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockApi.get).toHaveBeenCalledWith('/teams/t-1')
    // Exactly one read: a second one taken just before the write would narrow the
    // guarded window to nothing and make the precondition vacuous.
    expect(mockApi.get).toHaveBeenCalledTimes(1)
    expect(mockApi.patch).toHaveBeenCalledWith(
      '/teams/t-1',
      { name: 'Platform Core', description: null, normal_day_hours: 8 },
      { headers: { 'If-Match': '"tag-1"' } },
    )
  })

  it('reports a taken name on the name field', async () => {
    mockApi.get.mockResolvedValue(readResponse('"tag-1"'))
    mockApi.patch.mockRejectedValue(
      httpError(409, { error: 'TEAM_NAME_TAKEN', message: "A team named 'Frontline' already exists" }),
    )

    render(<EditTeamModal open team={team} onClose={onClose} />, { wrapper: makeWrapper() })
    await screen.findByLabelText(/^name/i)
    await userEvent.clear(screen.getByLabelText(/^name/i))
    await userEvent.type(screen.getByLabelText(/^name/i), 'Frontline')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('A team with this name already exists')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says the team changed when the write is stale, and keeps the dialog open', async () => {
    mockApi.get.mockResolvedValue(readResponse('"tag-1"'))
    mockApi.patch.mockRejectedValue(
      httpError(412, {
        error: 'STALE',
        message: 'This row changed since you read it.',
        current: { ...team, name: 'Platform (renamed elsewhere)' },
      }),
    )

    render(<EditTeamModal open team={team} onClose={onClose} />, { wrapper: makeWrapper() })
    await screen.findByLabelText(/^name/i)
    await userEvent.clear(screen.getByLabelText(/^name/i))
    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform Core')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/this team changed while you had it open/i)
    expect(alert).toHaveTextContent(/refreshed/i)
    expect(onClose).not.toHaveBeenCalled()
    // The edit survives, so resubmitting reapplies it against a fresh tag.
    expect(screen.getByLabelText(/^name/i)).toHaveValue('Platform Core')
  })

  it('retries a stale write against the tag the refresh brought back', async () => {
    mockApi.get
      .mockResolvedValueOnce(readResponse('"tag-1"'))
      .mockResolvedValue(readResponse('"tag-2"', { name: 'Renamed elsewhere' }))
    mockApi.patch
      .mockRejectedValueOnce(
        httpError(412, { error: 'STALE', message: 'changed', current: team }),
      )
      .mockResolvedValue(readResponse('"tag-3"', { name: 'Platform Core' }))

    render(<EditTeamModal open team={team} onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByLabelText(/^name/i)).toHaveValue('Platform'))
    await userEvent.clear(screen.getByLabelText(/^name/i))
    await userEvent.type(screen.getByLabelText(/^name/i), 'Platform Core')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    // The retry carries the tag from the refresh, not the one that was rejected,
    // and the user's typing is still what gets sent.
    expect(mockApi.patch).toHaveBeenLastCalledWith(
      '/teams/t-1',
      { name: 'Platform Core', description: null, normal_day_hours: 8 },
      { headers: { 'If-Match': '"tag-2"' } },
    )
  })
})
