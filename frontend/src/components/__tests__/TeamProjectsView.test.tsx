import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TeamProjectsView } from '../TeamProjectsView'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { MemberLoad, Project, ProjectPushStatus, TeamAssignment, User } from '@/types'

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

const assignment = (over: Partial<TeamAssignment> = {}): TeamAssignment => ({
  system_id: 'a-1',
  team_id: 't-1',
  project_id: 'p-1',
  project_name: 'ISK Portal',
  effort_unit: 'pts',
  share_pct: 70,
  available_source: 'manual',
  units_per_pd: 1,
  is_anchor: true,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"assignment-tag"',
  ...over,
})

const project = (id: string, name: string): Project =>
  ({ system_id: id, name, description: null, effort_unit: 'pts' } as Project)

const pushStatus = (over: Partial<ProjectPushStatus> = {}): ProjectPushStatus => ({
  project_id: 'p-1',
  project_name: 'ISK Portal',
  team_id: 't-1',
  team_name: 'Platform',
  share_pct: 70,
  available_source: 'factor',
  stale_sprints: 0,
  last_pushed_at: '2026-04-20T09:30:00Z',
  ...over,
})

const MEMBERS = [
  { system_id: 'm-1', name: 'Anna', counts_towards_capacity: true },
  { system_id: 'm-2', name: 'Bruno', counts_towards_capacity: true },
]

/**
 * Assignments, the project list, the team list, members and the staleness read
 * share one mocked axios.
 *
 * ``loads`` defaults to what the server reports when every assignment counts the
 * whole team: each member carries the sum of the shares.
 */
function respondWith(
  assignments: TeamAssignment[],
  projects: Project[] = [],
  statuses: ProjectPushStatus[] = [],
  loads?: MemberLoad[],
) {
  const total = assignments.reduce((sum, a) => sum + a.share_pct, 0)
  const memberLoads =
    loads ??
    MEMBERS.map((m) => ({
      member_id: m.system_id,
      name: m.name,
      share_pct: total,
      days_per_week: (total / 100) * 5,
      contracted_days: 5,
    }))
  mockApi.get.mockImplementation((url: string) => {
    if (url.startsWith('/team-capacity/status')) {
      return Promise.resolve({ data: statuses, headers: {} })
    }
    if (url === '/teams' || url === '/teams/') {
      return Promise.resolve({ data: [{ system_id: 't-1', member_loads: memberLoads }], headers: {} })
    }
    if (url.startsWith('/teams/t-1/members')) {
      return Promise.resolve({ data: MEMBERS, headers: {} })
    }
    return Promise.resolve({
      data: url.includes('/projects') && url.startsWith('/teams') ? assignments : projects,
      headers: {},
    })
  })
}

describe('TeamProjectsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    respondWith([assignment()])
  })

  it('marks the anchor, because it is why the capacity columns are those dates', async () => {
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    // The last row is the shares total, so the assignment is the first one.
    const rows = await screen.findAllByRole('listitem')
    const row = within(rows[0])
    expect(row.getByText('anchor')).toBeInTheDocument()
    expect(row.getByText('70%')).toBeInTheDocument()
    expect(row.getByText(/conversion — Available typed by hand/)).toBeInTheDocument()
  })

  it('shows the load, because one share only means something against the others', async () => {
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    // Every project counts the whole team, so everyone carries one load: the
    // old total, with no names needed.
    const total = within(await screen.findByText('Load').then((el) => el.closest('li') as HTMLElement))
    expect(total.getByText('70%')).toBeInTheDocument()
    expect(total.queryByText(/Anna/)).not.toBeInTheDocument()
  })

  it('says who each project counts, and groups the load by member once it differs', async () => {
    // Anna works only on the Portal; Bruno covers Data Exchange (ADR 0009).
    respondWith(
      [
        assignment({ share_pct: 100, all_members: false, member_ids: ['m-1'] }),
        assignment({
          system_id: 'a-2', project_id: 'p-2', project_name: 'Data Exchange',
          share_pct: 60, is_anchor: false, all_members: false, member_ids: ['m-2'],
        }),
      ],
      [],
      [],
      [
        { member_id: 'm-1', name: 'Anna', share_pct: 100, days_per_week: 5, contracted_days: 5 },
        { member_id: 'm-2', name: 'Bruno', share_pct: 60, days_per_week: 3, contracted_days: 5 },
      ],
    )
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    expect(await screen.findByText('counts Anna')).toBeInTheDocument()
    expect(screen.getByText('counts Bruno')).toBeInTheDocument()
    const load = within(screen.getByText('Load').closest('li') as HTMLElement)
    expect(load.getByText(/— Anna/)).toBeInTheDocument()
    expect(load.getByText(/— Bruno/)).toBeInTheDocument()
    // 160% summed, but nobody is over: no warning.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('warns above 100% and never blocks', async () => {
    // Teams really are overcommitted; refusing to represent that hides what the
    // tool exists to reveal (teams.md §6.3).
    respondWith([
      assignment({ share_pct: 70 }),
      assignment({ system_id: 'a-2', project_id: 'p-2', project_name: 'Data Exchange', share_pct: 60, is_anchor: false }),
    ])
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    expect(await screen.findByRole('status')).toHaveTextContent(
      '⚠ Over-allocated: Anna 130% · 6.5 of 5 d/wk, Bruno 130% · 6.5 of 5 d/wk. You can still save; the numbers will be optimistic.',
    )
    // Two assignments plus the total row: warned, and not one of them blocked.
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('says nothing when the shares are under 100%', async () => {
    // Slack and unassigned work are normal and are not flagged (§6.3).
    respondWith([assignment({ share_pct: 60 })])
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    await screen.findByText('ISK Portal')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a share in days and the members with one of their own', async () => {
    respondWith([
      assignment({
        share_days: 1,
        member_shares: [{ member_id: 'm-1', share_days: 2, share_pct: null }],
      }),
    ])
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    expect(await screen.findByText('1 d/wk')).toBeInTheDocument()
    expect(await screen.findByText('counts whole team · Anna 2 d/wk')).toBeInTheDocument()
  })

  it('shows the remaining project as what the others leave, with today’s total', async () => {
    respondWith(
      [
        assignment({ all_members: false, member_ids: ['m-1'], share_pct: 100 }),
        assignment({ system_id: 'a-2', project_id: 'p-2', project_name: 'Search', remaining: true, is_anchor: false }),
      ],
      [],
      [],
      [
        { member_id: 'm-1', name: 'Anna', share_pct: 100, days_per_week: 5, contracted_days: 5, remaining_days: 0 },
        { member_id: 'm-2', name: 'Bruno', share_pct: 100, days_per_week: 5, contracted_days: 5, remaining_days: 5 },
      ],
    )
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    expect(await screen.findByText('remaining')).toBeInTheDocument()
    const line = await screen.findByText('what the other projects leave · ≈ 5 d/wk today')
    expect(line).toHaveAttribute('title', 'Bruno 5 of 5 d/wk')
  })

  it('assigns a project, and says the first one sets the calendar', async () => {
    respondWith([], [project('p-1', 'ISK Portal'), project('p-2', 'Data Exchange')])
    mockApi.post.mockResolvedValue({ data: assignment(), headers: {} })
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: '+ Assign project' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/first project, so its sprint dates become the calendar/)).toBeInTheDocument()

    await userEvent.selectOptions(dialog.getByLabelText(/^Project/), 'p-2')
    await userEvent.click(dialog.getByRole('button', { name: 'Assign project' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(mockApi.post).toHaveBeenCalledWith('/teams/t-1/projects', {
      project_id: 'p-2',
      share_pct: 100,
      available_source: 'manual',
      units_per_pd: 1,
      all_members: true,
      member_ids: [],
      member_shares: [],
    })
  })

  it('asks for a factor only once Available is derived', async () => {
    respondWith([], [project('p-1', 'ISK Portal')])
    mockApi.post.mockResolvedValue({ data: assignment(), headers: {} })
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: '+ Assign project' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByLabelText('Effort units per person-day')).not.toBeInTheDocument()

    await userEvent.click(dialog.getByRole('radio', { name: /Derived from the team/ }))
    expect(dialog.getByLabelText('Effort units per person-day')).toBeInTheDocument()
  })

  it('explains a project another team already serves', async () => {
    respondWith([], [project('p-1', 'ISK Portal')])
    mockApi.post.mockRejectedValue({
      response: {
        status: 409,
        data: { detail: { error: 'PROJECT_ALREADY_ASSIGNED', message: "'ISK Portal' is already served by 'Frontline'." } },
      },
    })
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: '+ Assign project' }))
    const dialog = within(screen.getByRole('dialog'))
    await userEvent.selectOptions(dialog.getByLabelText(/^Project/), 'p-1')
    await userEvent.click(dialog.getByRole('button', { name: 'Assign project' }))

    expect(await dialog.findByText(/already served by 'Frontline'/)).toBeInTheDocument()
  })

  it('promises that unassigning leaves the sprints alone', async () => {
    // Available is always a value someone wrote, so removing the team removes
    // nothing and plans do not silently deflate (§6.1).
    mockApi.delete.mockResolvedValue({ data: null, headers: {} })
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Unassign' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/keeps the Available it holds now/)).toBeInTheDocument()

    await userEvent.click(dialog.getByRole('button', { name: 'Unassign' }))
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalled())
    expect(mockApi.delete).toHaveBeenCalledWith('/teams/t-1/projects/p-1', {
      headers: { 'If-Match': '"assignment-tag"' },
    })
  })

  it('gives a reader the list and none of the controls', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    expect(await screen.findByText('ISK Portal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Assign project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unassign' })).not.toBeInTheDocument()
  })
  // ── The push, and the staleness it resolves (§6.6, §6.7) ───────────────────

  it('shows how far a project has drifted from the team', async () => {
    respondWith([assignment({ available_source: 'factor' })], [], [pushStatus({ stale_sprints: 3 })])
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    expect(await screen.findByText('3 sprints differ from the team')).toBeInTheDocument()
  })

  it('offers the push, which is the only way the number reaches a project', async () => {
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    await userEvent.click(await screen.findByRole('button', { name: 'Update projects' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/Update projects from team Platform/)).toBeInTheDocument()
    expect(dialog.getByText(/Nothing is written until you apply/)).toBeInTheDocument()
  })

  it('hides the push from a reader, who cannot write a project', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    respondWith([assignment({ available_source: 'factor' })], [], [pushStatus({ stale_sprints: 2 })])
    render(<TeamProjectsView teamId="t-1" teamName="Platform" />, { wrapper: wrapper() })

    // The badge stays: staleness is information, not an action (design §1).
    expect(await screen.findByText('2 sprints differ from the team')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update projects' })).not.toBeInTheDocument()
  })
})
