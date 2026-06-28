import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIListPanel } from '../PIListPanel'
import * as pisService from '@/services/pis'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'

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
  useUiStore.setState({ activePIId: null })
})

describe('PIListPanel', () => {
  it('shows "Views" as the panel title', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Views')).toBeInTheDocument())
  })

  it('renders a pinned Backlog entry above the PI list and selects it on click', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Q1-2026'))
    await userEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    expect(useUiStore.getState().activePIId).toBeNull()
  })

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

  it('clicking + New PI opens create PI modal', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /\+ new pi/i }))
    await userEvent.click(screen.getByRole('button', { name: /\+ new pi/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('Delete button click shows confirm dialog', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Q1-2026'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(await screen.findByText('Delete PI')).toBeInTheDocument()
  })

  it('confirming Delete PI calls pisApi.delete with PI id', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Q1-2026'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }))
    expect(mockApi.delete).toHaveBeenCalledWith(fakePI.system_id)
  })

  it('clicking a PI item selects it, and clicking again returns to Backlog', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Q1-2026'))
    await userEvent.click(screen.getByRole('button', { name: /Q1-2026/i }))
    expect(useUiStore.getState().activePIId).toBe(fakePI.system_id)
    await userEvent.click(screen.getByRole('button', { name: /Q1-2026/i }))
    expect(useUiStore.getState().activePIId).toBeNull()
  })

  it('clicking Start PI and confirming calls pisApi.update with in_progress state', async () => {
    useAuthStore.setState({ isEditing: true })
    mockApi.list = vi.fn().mockResolvedValue([fakePI])
    mockApi.update = vi.fn().mockResolvedValue({ ...fakePI, state: 'in_progress' })
    render(<PIListPanel projectId="p-1" />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /start pi/i }))
    await userEvent.click(screen.getByRole('button', { name: /start pi/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /start pi/i }))
    expect(mockApi.update).toHaveBeenCalledWith(fakePI.system_id, { state: 'in_progress' })
  })
})
