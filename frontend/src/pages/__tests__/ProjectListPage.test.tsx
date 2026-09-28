import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectListPage } from '../ProjectListPage'
import * as projectsService from '@/services/projects'
import * as teamsService from '@/services/teams'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import type { Project, Team, User } from '@/types'

const stamps = { created_at: '2026-01-01T00:00:00Z', last_login_at: null, password_changed_at: null }

// No team serves these projects, so there is no push status to show.
vi.mock('@/services/teamPush', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/teamPush')>()
  return { ...actual, teamPushApi: { ...actual.teamPushApi, status: vi.fn().mockResolvedValue([]) } }
})

// No snapshots taken.
vi.mock('@/services/snapshots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/snapshots')>()
  return { ...actual, snapshotsApi: { ...actual.snapshotsApi, list: vi.fn().mockResolvedValue([]) } }
})

vi.mock('@/services/projects')
// Only the client is faked: the error readers (`teamErrorCode`, `blockingProjects`)
// are the code under test wherever a 409 or 412 is asserted.
vi.mock('@/services/teams', async (importOriginal) => {
  const actual = await importOriginal<typeof teamsService>()
  return {
    ...actual,
    teamsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  }
})
const mockApi = vi.mocked(projectsService.projectsApi)
const mockTeams = vi.mocked(teamsService.teamsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakeProject = {
  system_id: 'proj-1',
  name: 'My Project',
  description: 'A test project',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

describe('ProjectListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTeams.list = vi.fn().mockResolvedValue([])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders project names from API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('My Project')).toBeInTheDocument())
    expect(screen.getByText('A test project')).toBeInTheDocument()
  })

  it('shows empty state when no projects', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('No projects yet')).toBeInTheDocument())
  })

  it('shows New Project button', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument())
  })

  it('opens create modal on button click', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /new project/i }))
    await userEvent.click(screen.getByRole('button', { name: /new project/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders Azure DevOps link when project has a URL', async () => {
    mockApi.list = vi.fn().mockResolvedValue([
      { ...fakeProject, azure_devops_url: 'https://dev.azure.com/org/proj' },
    ])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const link = await screen.findByRole('link', { name: /azure devops/i })
    expect(link).toHaveAttribute('href', 'https://dev.azure.com/org/proj')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render Azure DevOps link when project has no URL', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ ...fakeProject, azure_devops_url: null }])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('My Project')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /azure devops/i })).not.toBeInTheDocument()
  })

  it('shows delete button per project', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    // Row actions are icon buttons; the label is their accessible name and their
    // tooltip, which is what every selector here uses.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())
  })

  it('shows Export button per project', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument())
  })

  it('shows Snapshots button per project and opens the modal on click', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Snapshots' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Snapshots' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Snapshots' })).toBeInTheDocument()
  })

  it('shows Edit button per project and opens the edit modal with the effort unit field', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ ...fakeProject, effort_unit: 'pts' }])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Edit Project' })).toBeInTheDocument()
    expect(screen.getByLabelText('Effort unit')).toBeInTheDocument()
  })

  it('Export button shows loading state during fetch', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])

    // Stub browser APIs unavailable in jsdom
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:fake'), revokeObjectURL: vi.fn() })

    let resolveFetch!: (v: Response) => void
    const fetchPromise = new Promise<Response>((res) => { resolveFetch = res })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise))

    // Stub anchor click so no navigation happens
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: 'Export' }))

    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    // The glyph cannot say "Exporting…", so the label does.
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeInTheDocument()

    resolveFetch(new Response(new Blob(['{}'], { type: 'application/json' }), {
      headers: { 'Content-Disposition': 'attachment; filename="test.json"' },
    }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument())

    clickSpy.mockRestore()
  })

  it('shows Import button in page header', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const projectsSection = await screen.findByRole('region', { name: 'Projects' })
    expect(within(projectsSection).getByRole('button', { name: /^import$/i })).toBeInTheDocument()
  })

  it('Import shows loading state while fetching', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])

    let resolveFetch!: (v: Response) => void
    const fetchPromise = new Promise<Response>((res) => { resolveFetch = res })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise))

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const projectsSection = await screen.findByRole('region', { name: 'Projects' })
    await waitFor(() => within(projectsSection).getByRole('button', { name: /^import$/i }))

    const file = new File(['{}'], 'backup.json', { type: 'application/json' })
    await userEvent.upload(screen.getByLabelText('Import project file'), file)

    expect(screen.getByText('Importing…')).toBeInTheDocument()

    resolveFetch(new Response(JSON.stringify({ system_id: 'new-1', name: 'Imported' }), { status: 201 }))
    await waitFor(() => expect(within(projectsSection).getByRole('button', { name: /^import$/i })).toBeInTheDocument())
  })

  it('Import invalidates projects query on success', async () => {
    let listCallCount = 0
    mockApi.list = vi.fn().mockImplementation(() => {
      listCallCount++
      return Promise.resolve([])
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ system_id: 'new-1', name: 'Imported' }), { status: 201 })
    ))

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const projectsSection = await screen.findByRole('region', { name: 'Projects' })
    await waitFor(() => within(projectsSection).getByRole('button', { name: /^import$/i }))
    const callsBefore = listCallCount

    const file = new File(['{}'], 'backup.json', { type: 'application/json' })
    await userEvent.upload(screen.getByLabelText('Import project file'), file)

    await waitFor(() => expect(listCallCount).toBeGreaterThan(callsBefore))
  })

  it('Import shows error message on server failure', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: { message: 'Invalid format' } }), { status: 422 })
    ))

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const projectsSection = await screen.findByRole('region', { name: 'Projects' })
    await waitFor(() => within(projectsSection).getByRole('button', { name: /^import$/i }))

    const file = new File(['bad'], 'bad.json', { type: 'application/json' })
    await userEvent.upload(screen.getByLabelText('Import project file'), file)

    await waitFor(() => expect(screen.getByText('Invalid format')).toBeInTheDocument())
  })

  // ── Role-based visibility ────────────────────────────────────────────────────

  it('reader sees project names but no edit buttons', async () => {
    useAuthStore.setState({ user: { username: 'bob', display_name: 'Bob', role: 'reader', ...stamps } })
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('My Project')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Snapshots' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('editor sees all action buttons', async () => {
    useAuthStore.setState({ user: { username: 'alice', display_name: 'Alice', role: 'editor', ...stamps } })
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument())
    const projectsSection = screen.getByRole('region', { name: 'Projects' })
    expect(within(projectsSection).getByRole('button', { name: /^import$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Snapshots' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('admin sees all action buttons', async () => {
    useAuthStore.setState({ user: { username: 'admin', display_name: 'Admin', role: 'admin', ...stamps } })
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Snapshots' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})


// ── Teams section (teams.md §7.0, §7.1) ──────────────────────────────────────

const project = (over: Partial<Project> = {}): Project => ({
  system_id: 'p-1',
  name: 'ISK Portal',
  description: null,
  azure_devops_url: null,
  work_item_path_template: null,
  effort_unit: 'pts',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...over,
})

const team = (over: Partial<Team> = {}): Team => ({
  system_id: 't-1',
  name: 'Platform',
  description: null,
  normal_day_hours: 8,
  member_count: 6,
  project_ids: ['p-1'],
  project_shares: { 'p-1': 70 },
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  ...over,
})

const editor: User = {
  username: 'ed',
  display_name: null,
  role: 'editor',
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: null,
  password_changed_at: null,
}

/** A rejection shaped the way FastAPI wraps our business errors. */
const httpError = (status: number, detail: unknown) => ({ response: { status, data: { detail } } })

// Both sections only exist once the projects query has resolved, so these await.
const teamsSection = () => screen.findByRole('region', { name: 'Teams' })
const projectsSection = () => screen.findByRole('region', { name: 'Projects' })

describe('ProjectListPage — Teams section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: editor, isEditing: false })
    useUiStore.setState({ activeProjectId: null, activeTeamId: null, activePIId: null })
    mockApi.list = vi.fn().mockResolvedValue([project()])
    mockTeams.list = vi.fn().mockResolvedValue([team()])
  })

  it('renders a Projects section and a Teams section', async () => {
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument()
    expect(await within(await teamsSection()).findByText('Platform')).toBeInTheDocument()
  })

  it('shows the team serving a project with its share, and "No team" for the rest', async () => {
    mockApi.list = vi.fn().mockResolvedValue([
      project(),
      project({ system_id: 'p-2', name: 'Data Exchange' }),
    ])
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    const rows = await within(await projectsSection()).findAllByRole('listitem')
    expect(within(rows[0]).getByText('Platform')).toBeInTheDocument()
    // The share belongs beside the name: a team name alone reads as though the
    // whole team were on this project (§6.3).
    expect(within(rows[0]).getByText('· 70%')).toBeInTheDocument()
    expect(within(rows[1]).getByText('No team')).toBeInTheDocument()
  })

  it('counts members in their own column and names what the team serves', async () => {
    mockApi.list = vi.fn().mockResolvedValue([project()])
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    const row = within(await within(await teamsSection()).findByRole('listitem'))
    // The count is a number under a Members header; its accessible label keeps
    // the words a screen reader needs.
    expect(row.getByLabelText('6 members')).toHaveTextContent('6')
    // Serves names each project with its share — the pairing the landing page exists for.
    expect(row.getByText(/ISK Portal/)).toBeInTheDocument()
    expect(row.getByText('70%')).toBeInTheDocument()
  })

  it('warns on the team row when its shares add up past 100%', async () => {
    // The shares are only all visible here, so this is where Σ > 100% surfaces (§6.3).
    mockApi.list = vi.fn().mockResolvedValue([project(), project({ system_id: 'p-2', name: 'Data Exchange' })])
    mockTeams.list = vi.fn().mockResolvedValue([
      team({ project_ids: ['p-1', 'p-2'], project_shares: { 'p-1': 70, 'p-2': 60 } }),
    ])
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    expect(await screen.findByText('Σ 130% — over-allocated')).toBeInTheDocument()
  })

  it('says a team serves nothing rather than showing an empty column', async () => {
    mockTeams.list = vi.fn().mockResolvedValue([team({ project_ids: [], project_shares: {} })])
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    expect(await screen.findByText('no project yet')).toBeInTheDocument()
  })

  it('shows the teams empty state when there are none', async () => {
    mockTeams.list = vi.fn().mockResolvedValue([])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    expect(
      await screen.findByText(
        'No teams yet — a team lets you compute sprint capacity from who is available.',
      ),
    ).toBeInTheDocument()
  })

  it('opens the team when its row is clicked', async () => {
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await userEvent.click(await within(await teamsSection()).findByRole('button', { name: 'Platform' }))
    expect(useUiStore.getState().activeTeamId).toBe('t-1')
    expect(useUiStore.getState().activeProjectId).toBeNull()
  })

  it('opens the create-team modal from the section header', async () => {
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await userEvent.click(await within(await teamsSection()).findByRole('button', { name: /new team/i }))
    expect(await screen.findByRole('heading', { name: 'New Team' })).toBeInTheDocument()
  })

  it('gives a reader the team rows and counts but no write affordances', async () => {
    useAuthStore.setState({ user: { ...editor, username: 'reader', role: 'reader' } })
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    const teams = await teamsSection()
    expect(await within(teams).findByText('Platform')).toBeInTheDocument()
    // A reader loses the Actions column and both + buttons; the counts and the
    // shares stay, because they are information rather than actions (design §1).
    expect(within(teams).getByLabelText('6 members')).toBeInTheDocument()
    expect(within(teams).queryByRole('button', { name: /new team/i })).not.toBeInTheDocument()
    expect(within(teams).queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(within(teams).queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  it('names the projects that block a team deletion', async () => {
    mockTeams.get = vi.fn().mockResolvedValue({ team: team(), etag: '"tag-1"' })
    mockTeams.delete = vi.fn().mockRejectedValue(
      httpError(409, {
        error: 'TEAM_HAS_PROJECTS',
        message: "Unassign this team's projects before deleting it.",
        projects: [
          { system_id: 'p-1', name: 'ISK Portal' },
          { system_id: 'p-2', name: 'Data Exchange' },
        ],
      }),
    )
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    await userEvent.click(await within(await teamsSection()).findByRole('button', { name: /^delete$/i }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Unassign these projects before deleting this team:')
    expect(within(alert).getByText('ISK Portal')).toBeInTheDocument()
    expect(within(alert).getByText('Data Exchange')).toBeInTheDocument()
  })

  it('deletes a team with the If-Match it read', async () => {
    mockTeams.get = vi.fn().mockResolvedValue({ team: team(), etag: '"tag-9"' })
    mockTeams.delete = vi.fn().mockResolvedValue(undefined)
    render(<ProjectListPage />, { wrapper: makeWrapper() })

    await userEvent.click(await within(await teamsSection()).findByRole('button', { name: /^delete$/i }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mockTeams.delete).toHaveBeenCalledWith('t-1', '"tag-9"'))
  })

  it('shows an Export button per team, separate from the Projects one', async () => {
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const teams = await teamsSection()
    expect(within(teams).getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(await screen.findAllByRole('button', { name: 'Export' })).toHaveLength(2)
  })

  it('Export button on a team row fetches the team export endpoint', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:fake'), revokeObjectURL: vi.fn() })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['{}'], { type: 'application/json' }), {
        headers: { 'Content-Disposition': 'attachment; filename="Platform.json"' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const teams = await teamsSection()
    await userEvent.click(within(teams).getByRole('button', { name: 'Export' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/teams/t-1/export', { credentials: 'include' })
  })

  it('shows an Import button in the Teams header, separate from the Projects one', async () => {
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    const teams = await teamsSection()
    expect(within(teams).getByRole('button', { name: /^import$/i })).toBeInTheDocument()
    expect(await screen.findAllByRole('button', { name: /^import$/i })).toHaveLength(2)
  })

  it('Import in the Teams header posts to the team import endpoint and refreshes the list', async () => {
    let listCallCount = 0
    mockTeams.list = vi.fn().mockImplementation(() => {
      listCallCount++
      return Promise.resolve([team()])
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ system_id: 't-2', name: 'Imported Team' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await teamsSection()
    const callsBefore = listCallCount

    const file = new File(['{}'], 'team-backup.json', { type: 'application/json' })
    await userEvent.upload(screen.getByLabelText('Import team file'), file)

    await waitFor(() => expect(listCallCount).toBeGreaterThan(callsBefore))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/teams/import',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
