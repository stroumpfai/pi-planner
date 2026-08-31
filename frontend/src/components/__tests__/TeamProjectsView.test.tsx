import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TeamProjectsView } from '../TeamProjectsView'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { Project, TeamAssignment, User } from '@/types'

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

/** Assignments and the project list come off the same mocked axios instance. */
function respondWith(assignments: TeamAssignment[], projects: Project[] = []) {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.includes('/projects') && url.startsWith('/teams') ? assignments : projects,
      headers: {},
    }),
  )
}

describe('TeamProjectsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    respondWith([assignment()])
  })

  it('marks the anchor, because it is why the capacity columns are those dates', async () => {
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

    // The last row is the shares total, so the assignment is the first one.
    const rows = await screen.findAllByRole('listitem')
    const row = within(rows[0])
    expect(row.getByText('anchor')).toBeInTheDocument()
    expect(row.getByText('70%')).toBeInTheDocument()
    expect(row.getByText(/conversion — Available typed by hand/)).toBeInTheDocument()
  })

  it('totals the shares, because one share only means something against the others', async () => {
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

    const rows = await screen.findAllByRole('listitem')
    const total = within(rows[rows.length - 1])
    expect(total.getByText('Total')).toBeInTheDocument()
    expect(total.getByText('70%')).toBeInTheDocument()
  })

  it('warns above 100% and never blocks', async () => {
    // Teams really are overcommitted; refusing to represent that hides what the
    // tool exists to reveal (teams.md §6.3).
    respondWith([
      assignment({ share_pct: 70 }),
      assignment({ system_id: 'a-2', project_id: 'p-2', project_name: 'Data Exchange', share_pct: 60, is_anchor: false }),
    ])
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByRole('status')).toHaveTextContent(
      '⚠ Shares total 130% — this team is over-allocated. You can still save; the numbers will be optimistic.',
    )
    // Two assignments plus the total row: warned, and not one of them blocked.
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('says nothing when the shares are under 100%', async () => {
    // Slack and unassigned work are normal and are not flagged (§6.3).
    respondWith([assignment({ share_pct: 60 })])
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

    await screen.findByText('ISK Portal')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('assigns a project, and says the first one sets the calendar', async () => {
    respondWith([], [project('p-1', 'ISK Portal'), project('p-2', 'Data Exchange')])
    mockApi.post.mockResolvedValue({ data: assignment(), headers: {} })
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

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
    })
  })

  it('asks for a factor only once Available is derived', async () => {
    respondWith([], [project('p-1', 'ISK Portal')])
    mockApi.post.mockResolvedValue({ data: assignment(), headers: {} })
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

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
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

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
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

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
    render(<TeamProjectsView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByText('ISK Portal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Assign project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unassign' })).not.toBeInTheDocument()
  })
})
