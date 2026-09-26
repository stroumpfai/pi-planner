import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TeamMembersView } from '../TeamMembersView'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { PatternVersion, TeamMember, User } from '@/types'

// Only the axios instance is faked: `services/teamMembers` and the hooks run for
// real, because the ETag each write quotes is what most of these assert on.
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock; patch: Mock; delete: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const version = (over: Partial<PatternVersion> = {}): PatternVersion => ({
  system_id: 'v-1',
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
  focus: 0.7,
  note: null,
  created_at: '2026-09-01T00:00:00Z',
  modified_at: '2026-09-01T00:00:00Z',
  etag: '"version-tag"',
  ...over,
})

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  system_id: 'm-1',
  team_id: 't-1',
  name: 'Aïcha Ben Salah',
  role: 'SW-Arch',
  organisation: 'Dev',
  active_from: null,
  active_to: null,
  counts_towards_capacity: true,
  order_index: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"member-tag"',
  effective_version: version(),
  version_dates: ['2026-01-01', '2026-09-01'],
  absence_count: 3,
  meeting_count: 2,
  ...over,
})

const asEditor = () =>
  useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })

describe('TeamMembersView', () => {
  const onOpenWorkingDays = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    asEditor()
    mockApi.get.mockResolvedValue({ data: [member()], headers: {} })
  })

  it('shows hours and focus with the date they took effect', async () => {
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    expect(await screen.findByText('Aïcha Ben Salah')).toBeInTheDocument()
    expect(screen.getByText('8.0 h · since 01.09.26')).toBeInTheDocument()
    expect(screen.getByText('0.70')).toBeInTheDocument()
  })

  it('sends the reader to Working days rather than editing hours in place', async () => {
    // Changing hours means dating a new version, so the chip is a link, not a
    // field (teams.md §7.2).
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByText('8.0 h · since 01.09.26'))
    expect(onOpenWorkingDays).toHaveBeenCalledWith('m-1')

    // And there is nowhere to type either number on this screen.
    expect(screen.queryByLabelText(/hours per day/i)).not.toBeInTheDocument()
  })

  it('names what a removal takes with it, and the alternative', async () => {
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    // Row actions live behind the ⋯ menu, which is also the non-drag path to
    // reordering (design §3).
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Aïcha Ben Salah' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText(/2 working-pattern versions/)).toBeInTheDocument()
    expect(within(dialog).getByText(/3 absences/)).toBeInTheDocument()
    expect(within(dialog).getByText(/2 meetings/)).toBeInTheDocument()
    expect(within(dialog).getByText(/"until" date instead/)).toBeInTheDocument()
  })

  it('quotes the row a removal was shown, not a freshly read one', async () => {
    mockApi.delete.mockResolvedValue({ data: null, headers: {} })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Aïcha Ben Salah' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: /^Remove$/ }))

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalled())
    expect(mockApi.delete).toHaveBeenCalledWith('/teams/t-1/members/m-1', {
      headers: { 'If-Match': '"member-tag"' },
    })
  })

  it('reorders by sending the whole order, and moves the row it was told to', async () => {
    mockApi.get.mockResolvedValue({
      data: [member(), member({ system_id: 'm-2', name: 'Rui Domingues' })],
      headers: {},
    })
    mockApi.post.mockResolvedValue({ data: [], headers: {} })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Rui Domingues' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(mockApi.post).toHaveBeenCalledWith('/teams/t-1/members/reorder', {
      order: ['m-2', 'm-1'],
    })
  })

  it('lists members who do not count after those who do, whatever the saved order', async () => {
    mockApi.get.mockResolvedValue({
      data: [
        member({ system_id: 'm-2', name: 'Pia Moser', counts_towards_capacity: false }),
        member(),
      ],
      headers: {},
    })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    await screen.findByText('Pia Moser')
    const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(names[0]).toContain('Aïcha Ben Salah')
    expect(names[1]).toContain('Pia Moser')
    expect(screen.getByText(/tracked for absences only: Pia Moser \(SW-Arch\)/)).toBeInTheDocument()
  })

  it('never moves a member across the rule, since that would flip their flag', async () => {
    mockApi.get.mockResolvedValue({
      data: [member(), member({ system_id: 'm-2', name: 'Pia Moser', counts_towards_capacity: false })],
      headers: {},
    })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    // Pia is first below the rule, so there is nothing above her to move past.
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Pia Moser' }))
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('marks a member who does not count towards capacity, and only them', async () => {
    mockApi.get.mockResolvedValue({
      data: [member(), member({ system_id: 'm-2', name: 'Pia Moser', counts_towards_capacity: false })],
      headers: {},
    })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    await screen.findByText('Pia Moser')
    expect(screen.getAllByText('not counted')).toHaveLength(1)
    const pia = screen.getByText('Pia Moser').closest('li')
    expect(pia).not.toBeNull()
    expect(within(pia as HTMLElement).getByText('not counted')).toBeInTheDocument()
  })

  it('switches a member off capacity from the edit dialog', async () => {
    mockApi.patch.mockResolvedValue({ data: member({ counts_towards_capacity: false }), headers: {} })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Aïcha Ben Salah' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    const counts = within(dialog).getByLabelText('Counts towards capacity')
    expect(counts).toBeChecked()
    await userEvent.click(counts)
    await userEvent.click(within(dialog).getByRole('button', { name: /^Save/ }))

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    const [url, body] = mockApi.patch.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/teams/t-1/members/m-1')
    expect(body.counts_towards_capacity).toBe(false)
  })

  it('gives a reader the list and none of the controls', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    expect(await screen.findByText('Aïcha Ben Salah')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Drag to reorder/ })).not.toBeInTheDocument()
  })

  it('says the team is empty rather than showing an empty table', async () => {
    mockApi.get.mockResolvedValue({ data: [], headers: {} })
    render(<TeamMembersView teamId="t-1" onOpenWorkingDays={onOpenWorkingDays} />, { wrapper: wrapper() })

    expect(await screen.findByText(/No members yet — capacity will read 0/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add the first member' })).toBeInTheDocument()
  })
})
