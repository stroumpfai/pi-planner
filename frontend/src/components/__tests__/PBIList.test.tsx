import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PBIList } from '../PBIList'
import * as pbisService from '@/services/pbis'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/services/pbis')
const mockApi = vi.mocked(pbisService.pbisApi)

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakePBI = {
  system_id: 'p-1',
  id: 102,
  title: 'Login UI',
  description: null,
  effort: 3,
  location: 'backlog' as const,
  pi_id: null,
  swimlane_id: null,
  group_id: null,
  project_id: 'proj-1',
  parent_feature_system_id: 'feat-1',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('PBIList', () => {
  it('shows "No stories yet" when empty', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PBIList featureId="feat-1" projectId="proj-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/no stories yet/i)).toBeInTheDocument())
  })

  it('renders PBI rows from API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakePBI])
    render(<PBIList featureId="feat-1" projectId="proj-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Login UI')).toBeInTheDocument())
    expect(screen.getByText('3pts')).toBeInTheDocument()
  })

  it('fetches with feature_id param', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PBIList featureId="feat-1" projectId="proj-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(mockApi.list).toHaveBeenCalledWith('proj-1', 'feat-1'))
  })

  it('+ PBI button disabled when not in edit mode', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PBIList featureId="feat-1" projectId="proj-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /^\+ pbi$/i })).toBeDisabled())
  })

  it('+ PBI button enabled in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PBIList featureId="feat-1" projectId="proj-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByRole('button', { name: /^\+ pbi$/i })).not.toBeDisabled())
  })

  it('opens create modal when + PBI clicked in edit mode', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PBIList featureId="feat-1" projectId="proj-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /^\+ pbi$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^\+ pbi$/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
