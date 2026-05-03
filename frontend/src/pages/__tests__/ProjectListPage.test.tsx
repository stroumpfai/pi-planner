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
})
