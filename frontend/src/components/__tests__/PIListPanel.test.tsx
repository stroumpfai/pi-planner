import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIListPanel } from '../PIListPanel'
import * as pisService from '@/services/pis'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/services/pis')
const mockApi = vi.mocked(pisService.pisApi)

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakePI = {
  system_id: 'pi-1',
  project_id: 'p-1',
  name: 'Q1-2026',
  description: null,
  state: 'draft' as const,
  start_date: null,
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('PIListPanel', () => {
  it('shows "No PIs yet" when empty', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/no pis yet/i)).toBeInTheDocument())
  })

  it('renders PI names and state badges', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Q1-2026')).toBeInTheDocument())
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('+ New PI disabled when not in edit mode', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /\+ new pi/i })).toBeDisabled())
  })

  it('+ New PI enabled in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /\+ new pi/i })).not.toBeDisabled())
  })

  it('state transition buttons only shown in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /start pi/i })).toBeInTheDocument())
  })

  it('state transition buttons hidden when not in edit mode', async () => {
    useAuthStore.setState({ isEditing: false })
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Q1-2026'))
    expect(screen.queryByRole('button', { name: /start pi/i })).not.toBeInTheDocument()
  })
})
