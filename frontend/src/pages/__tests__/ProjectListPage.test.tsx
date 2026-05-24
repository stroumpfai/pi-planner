import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectListPage } from '../ProjectListPage'
import * as projectsService from '@/services/projects'

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
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

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
})
