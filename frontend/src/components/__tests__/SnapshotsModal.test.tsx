import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SnapshotsModal } from '../SnapshotsModal'
import * as snapshotsService from '@/services/snapshots'
import { useAuthStore } from '@/stores/authStore'
import type { Snapshot } from '@/types'

const stamps = { created_at: '2026-01-01T00:00:00Z', last_login_at: null, password_changed_at: null }

vi.mock('@/services/snapshots')
const mockApi = vi.mocked(snapshotsService.snapshotsApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakeSnapshot: Snapshot = {
  system_id: 'snap-1',
  name: 'Before refactor',
  created_at: '2026-06-01T10:00:00Z',
  created_by: 'alice',
}

const fakeSnapshot2: Snapshot = {
  system_id: 'snap-2',
  name: 'Sprint 3 planning',
  created_at: '2026-05-15T08:30:00Z',
  created_by: null,
}

describe('SnapshotsModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'alice', display_name: 'Alice', role: 'editor', ...stamps } })
  })

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the snapshot list from the API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot, fakeSnapshot2])
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Before refactor')).toBeInTheDocument())
    expect(screen.getByText('Sprint 3 planning')).toBeInTheDocument()
    expect(screen.getByText(/by alice/)).toBeInTheDocument()
  })

  it('shows loading state while fetching', () => {
    mockApi.list = vi.fn().mockReturnValue(new Promise(() => {}))
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when there are no snapshots', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('No snapshots yet.')).toBeInTheDocument())
  })

  it('shows error state with retry on failure', async () => {
    mockApi.list = vi.fn().mockRejectedValue(new Error('fail'))
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Failed to load snapshots.')).toBeInTheDocument())
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('does not fetch when closed', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<SnapshotsModal projectId="p-1" open={false} onClose={onClose} />, { wrapper: makeWrapper() })
    expect(mockApi.list).not.toHaveBeenCalled()
  })

  // ── Create form ──────────────────────────────────────────────────────────────

  it('submits the create snapshot form with the entered name', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    mockApi.create = vi.fn().mockResolvedValue(fakeSnapshot)
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => expect(screen.getByLabelText('Snapshot name')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Snapshot name'), 'My snapshot')
    await userEvent.click(screen.getByRole('button', { name: /create snapshot/i }))

    await waitFor(() => expect(mockApi.create).toHaveBeenCalledWith('p-1', { name: 'My snapshot' }))
  })

  it('falls back to a default timestamped name when input is left blank', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    mockApi.create = vi.fn().mockResolvedValue(fakeSnapshot)
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => expect(screen.getByLabelText('Snapshot name')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /create snapshot/i }))

    await waitFor(() => expect(mockApi.create).toHaveBeenCalled())
    const [, body] = mockApi.create.mock.calls[0]
    expect(body.name).toMatch(/^Snapshot \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  // ── Restore flow ─────────────────────────────────────────────────────────────

  it('opens a confirm dialog warning about overwriting data on Restore click', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot])
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByText('Before refactor'))
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(screen.getByText('Restore "Before refactor"?')).toBeInTheDocument()
    expect(screen.getByText(/overwrite ALL current project data/)).toBeInTheDocument()
    expect(screen.getByText(/safety snapshot of the current state will be taken automatically/)).toBeInTheDocument()
  })

  it('calls restore API on confirm', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot])
    mockApi.restore = vi.fn().mockResolvedValue({ system_id: 'p-1', name: 'Project' })
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByText('Before refactor'))
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

    const dialog = await screen.findByRole('dialog', { name: /restore "before refactor"\?/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(mockApi.restore).toHaveBeenCalledWith('p-1', 'snap-1'))
  })

  // ── Delete flow ──────────────────────────────────────────────────────────────

  it('opens a destructive confirm dialog on Delete click', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot])
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByText('Before refactor'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByText('Delete "Before refactor"?')).toBeInTheDocument()
  })

  it('calls delete API on confirm', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot])
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByText('Before refactor'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog', { name: /delete "before refactor"\?/i })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('p-1', 'snap-1'))
  })

  // ── canEdit gating ───────────────────────────────────────────────────────────

  it('hides Restore/Delete buttons and the create form for readers', async () => {
    useAuthStore.setState({ user: { username: 'bob', display_name: 'Bob', role: 'reader', ...stamps } })
    mockApi.list = vi.fn().mockResolvedValue([fakeSnapshot])
    render(<SnapshotsModal projectId="p-1" open onClose={onClose} />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByText('Before refactor'))
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Snapshot name')).not.toBeInTheDocument()
  })
})
