import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkingDaysView } from '../WorkingDaysView'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { PatternVersion, TeamMember, User } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock; patch: Mock; delete: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const version = (over: Partial<PatternVersion> = {}): PatternVersion => ({
  system_id: 'v-2',
  member_id: 'm-1',
  effective_from: '2026-09-01',
  mon_am: true, mon_pm: true,
  tue_am: true, tue_pm: true,
  wed_am: true, wed_pm: true,
  thu_am: true, thu_pm: true,
  fri_am: true, fri_pm: false,
  sat_am: false, sat_pm: false,
  sun_am: false, sun_pm: false,
  hours_per_day: 8,
  focus: 0.9,
  note: null,
  created_at: '2026-09-01T00:00:00Z',
  modified_at: '2026-09-01T00:00:00Z',
  etag: '"version-tag"',
  ...over,
})

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  system_id: 'm-1',
  team_id: 't-1',
  name: 'Katrin Hofstetter',
  role: 'UX',
  organisation: 'BIT',
  active_from: null,
  active_to: null,
  order_index: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"member-tag"',
  effective_version: version(),
  version_dates: ['2026-01-01', '2026-09-01'],
  absence_count: 0,
  meeting_count: 0,
  ...over,
})

const lastGetParams = () => {
  const calls = mockApi.get.mock.calls as [string, { params?: { as_of?: string } } | undefined][]
  return calls[calls.length - 1][1]?.params
}

describe('WorkingDaysView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    mockApi.get.mockResolvedValue({ data: [member()], headers: {} })
    mockApi.patch.mockResolvedValue({ data: version(), headers: {} })
    mockApi.post.mockResolvedValue({ data: version(), headers: {} })
  })

  it('asks for the pattern in force on the chosen date, not simply the latest', async () => {
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByText('Katrin Hofstetter')

    await userEvent.clear(screen.getByLabelText('Pattern in effect on'))
    await userEvent.type(screen.getByLabelText('Pattern in effect on'), '15.03.2026')
    await userEvent.tab()

    await waitFor(() => expect(lastGetParams()?.as_of).toBe('2026-03-15'))
  })

  it('writes a toggled half-day to the version that date resolves to', async () => {
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('switch', { name: 'Katrin Hofstetter Fri pm' }))

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    expect(mockApi.patch).toHaveBeenCalledWith(
      '/teams/t-1/members/m-1/working-days/v-2',
      { fri_pm: true },
      // The tag of the version on screen — the baseline the user was shown (§4.2).
      { headers: { 'If-Match': '"version-tag"' } },
    )
  })

  it('warns that editing a past version does not move closed PIs', async () => {
    // Back-dating is allowed, and saying so is the whole point: a change to a
    // version that is already in force restates sprints that were planned on it,
    // except the closed ones, which never move (teams.md §3.3, §11).
    mockApi.get.mockResolvedValue({
      data: [member({ effective_version: version({ effective_from: '2025-01-01' }) })],
      headers: {},
    })
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByText(/sprints in closed PIs are not recomputed/i)).toBeInTheDocument()
  })

  it('does not warn about a version that has not taken effect yet', async () => {
    mockApi.get.mockResolvedValue({
      data: [member({ effective_version: version({ effective_from: '2099-01-01' }) })],
      headers: {},
    })
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await screen.findByText('Katrin Hofstetter')
    expect(screen.queryByText(/closed PIs are not recomputed/i)).not.toBeInTheDocument()
  })

  it('dates a new version from the Change from… dialog, carrying the current pattern', async () => {
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Change from…' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.clear(within(dialog).getByLabelText(/^Change from/))
    await userEvent.type(within(dialog).getByLabelText(/^Change from/), '01.11.2026')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save change' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const [url, body] = mockApi.post.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/teams/t-1/members/m-1/working-days')
    expect(body.effective_from).toBe('2026-11-01')
    // Pre-filled from the version in force, so a change is an edit rather than a
    // form filled in again (§3.3).
    expect(body.fri_am).toBe(true)
    expect(body.fri_pm).toBe(false)
    expect(body.focus).toBe(0.9)
  })

  it('says when a saved change would replace an existing version', async () => {
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Change from…' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.clear(within(dialog).getByLabelText(/^Change from/))
    await userEvent.type(within(dialog).getByLabelText(/^Change from/), '01.09.2026')
    await userEvent.tab()

    expect(await within(dialog).findByText(/saving replaces it/)).toBeInTheDocument()
  })

  it('lets a version marker move the whole view to that date', async () => {
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Pattern from 01.01.26' }))

    await waitFor(() => expect(lastGetParams()?.as_of).toBe('2026-01-01'))
  })

  it('sets a weekday for the whole team from the column header', async () => {
    // "Nobody works Fridays" is one click, not one per person (teams.md §7.3).
    mockApi.get.mockResolvedValue({
      data: [member(), member({ system_id: 'm-2', name: 'Rui Domingues' })],
      headers: {},
    })
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Toggle Mon for everyone' }))

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalledTimes(2))
    // Monday was fully on for everyone, so the click turns it off.
    expect(mockApi.patch.mock.calls[0][1]).toEqual({ mon_am: false, mon_pm: false })
    expect(mockApi.patch.mock.calls[1][0]).toContain('/members/m-2/')
  })

  it('fills a partly worked week rather than emptying it', async () => {
    mockApi.get.mockResolvedValue({
      data: [member({ effective_version: version({ fri_pm: false }) })],
      headers: {},
    })
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Toggle Fri for everyone' }))

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    expect(mockApi.patch.mock.calls[0][1]).toEqual({ fri_am: true, fri_pm: true })
  })

  it('toggles a whole member from their name', async () => {
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Toggle every half-day for Katrin Hofstetter' }),
    )

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    // Not every half-day was on — Friday afternoon and the weekend were off — so
    // the row fills.
    expect(mockApi.patch.mock.calls[0][1]).toMatchObject({ mon_am: true, sat_am: true, sun_pm: true })
  })

  it('gives a reader the grid without a way to change it', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    render(<WorkingDaysView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByRole('switch', { name: 'Katrin Hofstetter Mon am' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Change from…' })).not.toBeInTheDocument()
  })
})
