import { vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BacklogPage } from '../BacklogPage'
import * as featuresService from '@/services/features'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/services/features')
vi.mock('@/components/ImportCSVModal', () => ({
  ImportCSVModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <button data-testid="mock-import-close" onClick={onClose}>close-import</button> : null,
}))
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

  it('Import CSV button is disabled when not in edit mode', async () => {
    useAuthStore.setState({ isEditing: false })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /import csv/i })).toBeDisabled())
  })

  it('Import CSV button is enabled in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /import csv/i })).not.toBeDisabled())
  })

  it('clicking Newest sort button calls API with default sort', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /newest/i }))
    await userEvent.click(screen.getByRole('button', { name: /newest/i }))
    await waitFor(() => expect(mockApi.list).toHaveBeenCalledWith('p-1', 'created_at'))
  })

  it('file input change triggers handleFileChange and opens import modal', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /import csv/i }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['content'], 'test.csv', { type: 'text/csv' })
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
    fireEvent.change(fileInput)
    expect(await screen.findByTestId('mock-import-close')).toBeInTheDocument()
  })

  it('closing import modal calls handleImportClose', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /import csv/i }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['content'], 'test.csv', { type: 'text/csv' })],
      configurable: true,
    })
    fireEvent.change(fileInput)
    await screen.findByTestId('mock-import-close')
    await userEvent.click(screen.getByTestId('mock-import-close'))
    await waitFor(() => expect(screen.queryByTestId('mock-import-close')).not.toBeInTheDocument())
  })

  it('clicking + Feature in edit mode opens create feature modal', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<BacklogPage projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /\+ feature/i }))
    await userEvent.click(screen.getByRole('button', { name: /\+ feature/i }))
    expect(await screen.findByText('New Feature')).toBeInTheDocument()
  })
})
