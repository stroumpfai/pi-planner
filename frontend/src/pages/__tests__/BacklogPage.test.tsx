import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BacklogPage } from '../BacklogPage'
import * as featuresService from '@/services/features'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/services/features')
const mockApi = vi.mocked(featuresService.featuresApi)

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakeFeature = {
  system_id: 'f-1',
  id: 101,
  title: 'Auth Feature',
  description: null,
  effort: 5,
  location: 'backlog' as const,
  pi_id: null,
  swimlane_id: null,
  project_id: 'p-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('BacklogPage', () => {
  it('shows empty state when no features', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/no features in the backlog/i)).toBeInTheDocument())
  })

  it('renders feature rows from API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeFeature])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Auth Feature')).toBeInTheDocument())
    expect(screen.getByText('5pts')).toBeInTheDocument()
  })

  it('does not show PI features in backlog', async () => {
    const piFeature = { ...fakeFeature, system_id: 'f-2', title: 'In PI', location: 'pi' as const }
    mockApi.list = vi.fn().mockResolvedValue([fakeFeature, piFeature])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Auth Feature')).toBeInTheDocument())
    expect(screen.queryByText('In PI')).not.toBeInTheDocument()
  })

  it('+ Feature button disabled when not in edit mode', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /\+ feature/i })).toBeDisabled())
  })

  it('+ Feature button enabled in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /\+ feature/i })).not.toBeDisabled())
  })

  it('sort buttons visible', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /newest/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /name/i })).toBeInTheDocument()
  })

  it('clicking sort Name calls API with sort=name', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /name/i }))
    await userEvent.click(screen.getByRole('button', { name: /name/i }))
    await waitFor(() =>
      expect(mockApi.list).toHaveBeenCalledWith('p-1', 'name')
    )
  })

  it('shows total effort in footer', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeFeature])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() =>
      expect(screen.getByText('1 feature · 5 pts')).toBeInTheDocument()
    )
  })

  it('sums effort across multiple features', async () => {
    const feature2 = { ...fakeFeature, system_id: 'f-2', effort: 10 }
    mockApi.list = vi.fn().mockResolvedValue([fakeFeature, feature2])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() =>
      expect(screen.getByText('2 features · 15 pts')).toBeInTheDocument()
    )
  })

  it('omits effort from footer when total is zero', async () => {
    mockApi.list = vi.fn().mockResolvedValue([{ ...fakeFeature, effort: 0 }])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() =>
      expect(screen.getByText('1 feature')).toBeInTheDocument()
    )
    // Footer paragraph should contain only the count, no effort suffix
    expect(screen.queryByText(/1 feature ·/)).not.toBeInTheDocument()
  })
})
