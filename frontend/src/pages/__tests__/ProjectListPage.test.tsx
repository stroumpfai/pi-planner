import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectListPage } from '../ProjectListPage'
import * as projectsService from '@/services/projects'
import { useAuthStore } from '@/stores/authStore'

const stamps = { created_at: '2026-01-01T00:00:00Z', last_login_at: null, password_changed_at: null }

vi.mock('@/services/projects')
const mockApi = vi.mocked(projectsService.projectsApi)

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
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument())
  })

  it('shows Export button per project', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument())
  })

  it('shows Snapshots button per project and opens the modal on click', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Snapshots')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Snapshots'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Snapshots' })).toBeInTheDocument()
  })

  it('shows Edit button per project and opens the edit modal with the effort unit field', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ ...fakeProject, effort_unit: 'pts' }])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Edit')).toBeInTheDocument())

    await userEvent.click(screen.getByText('Edit'))
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
    await waitFor(() => screen.getByText('Export'))

    await userEvent.click(screen.getByText('Export'))
    expect(screen.getByText('Exporting…')).toBeInTheDocument()

    resolveFetch(new Response(new Blob(['{}'], { type: 'application/json' }), {
      headers: { 'Content-Disposition': 'attachment; filename="test.json"' },
    }))

    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument())

    clickSpy.mockRestore()
  })

  it('shows Import button in page header', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument())
  })

  it('Import shows loading state while fetching', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])

    let resolveFetch!: (v: Response) => void
    const fetchPromise = new Promise<Response>((res) => { resolveFetch = res })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise))

    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /^import$/i }))

    const file = new File(['{}'], 'backup.json', { type: 'application/json' })
    await userEvent.upload(screen.getByLabelText('Import project file'), file)

    expect(screen.getByText('Importing…')).toBeInTheDocument()

    resolveFetch(new Response(JSON.stringify({ system_id: 'new-1', name: 'Imported' }), { status: 201 }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument())
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
    await waitFor(() => screen.getByRole('button', { name: /^import$/i }))
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
    await waitFor(() => screen.getByRole('button', { name: /^import$/i }))

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
    expect(screen.queryByText('Export')).not.toBeInTheDocument()
    expect(screen.queryByText('Snapshots')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('editor sees all action buttons', async () => {
    useAuthStore.setState({ user: { username: 'alice', display_name: 'Alice', role: 'editor', ...stamps } })
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
    expect(screen.getByText('Snapshots')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('admin sees all action buttons', async () => {
    useAuthStore.setState({ user: { username: 'admin', display_name: 'Admin', role: 'admin', ...stamps } })
    mockApi.list = vi.fn().mockResolvedValue([fakeProject])
    render(<ProjectListPage />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument())
    expect(screen.getByText('Export')).toBeInTheDocument()
    expect(screen.getByText('Snapshots')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
