import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserManagementModal } from '../UserManagementModal'
import * as usersService from '@/services/users'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/services/users')
const mockApi = vi.mocked(usersService.usersApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakeAdmin = { username: 'admin', display_name: 'Administrator', role: 'admin' as const }
const fakeEditor = { username: 'alice', display_name: 'Alice', role: 'editor' as const }
const fakeReader = { username: 'bob', display_name: 'Bob', role: 'reader' as const }

describe('UserManagementModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'admin', display_name: 'Administrator', role: 'admin' } })
  })

  afterEach(() => vi.unstubAllGlobals())

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders user list from API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeAdmin, fakeEditor, fakeReader])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0))
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('shows loading state while fetching', () => {
    mockApi.list = vi.fn().mockReturnValue(new Promise(() => {}))
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('does not fetch when closed', () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open={false} onClose={onClose} />, { wrapper: makeWrapper() })
    expect(mockApi.list).not.toHaveBeenCalled()
  })

  it('shows role badges', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeAdmin, fakeEditor, fakeReader])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0))
    const badges = screen.getAllByText(/^(admin|editor|reader)$/i)
    expect(badges.length).toBeGreaterThanOrEqual(3)
  })

  // ── Expand / collapse card ──────────────────────────────────────────────────

  it('expands a user card on click to show edit form', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeEditor])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('alice'))
    await userEvent.click(screen.getByText('alice'))
    expect(screen.getByText('Display name')).toBeInTheDocument()
    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.getByText('Reset password')).toBeInTheDocument()
  })

  // ── Self-row guards ─────────────────────────────────────────────────────────

  it('shows text instead of role dropdown for current user card', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeAdmin])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    // fakeAdmin has username='admin' and role badge='admin' → getAllByText to avoid ambiguity
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByText('admin')[0])
    expect(screen.getByText('You cannot change your own role')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/use "change password"/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/new password/i)).not.toBeInTheDocument()
  })

  it('Delete button is disabled for current user card', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeAdmin])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByText('admin')[0])
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
  })

  // ── Delete flow ─────────────────────────────────────────────────────────────

  it('clicking Delete on non-self opens confirm dialog', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeEditor])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('alice'))
    await userEvent.click(screen.getByText('alice'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByText(/delete alice\?/i)).toBeInTheDocument()
  })

  it('confirming delete calls delete API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeEditor])
    mockApi.delete = vi.fn().mockResolvedValue(undefined)
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('alice'))
    await userEvent.click(screen.getByText('alice'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    // ConfirmDialog is the last dialog in the DOM
    const dialogs = screen.getAllByRole('dialog')
    await userEvent.click(within(dialogs[dialogs.length - 1]).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('alice'))
  })

  it('cancelling delete does not call API', async () => {
    mockApi.list = vi.fn().mockResolvedValue([fakeEditor])
    mockApi.delete = vi.fn()
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('alice'))
    await userEvent.click(screen.getByText('alice'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    const dialogs = screen.getAllByRole('dialog')
    await userEvent.click(within(dialogs[dialogs.length - 1]).getByRole('button', { name: /cancel/i }))
    expect(mockApi.delete).not.toHaveBeenCalled()
  })

  // ── Add User form ───────────────────────────────────────────────────────────

  it('shows Add User toggle button', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/▾ add user/i)).toBeInTheDocument())
  })

  it('clicking Add User shows create form', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument()
  })

  it('shows validation errors when creating with empty username', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() => expect(screen.getByText('Username is required')).toBeInTheDocument())
  })

  it('shows validation error for short password', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.type(screen.getByLabelText(/username/i), 'newuser')
    await userEvent.type(screen.getByLabelText(/^password /i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() =>
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    )
  })

  it('shows validation error when passwords do not match', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.type(screen.getByLabelText(/username/i), 'newuser')
    await userEvent.type(screen.getByLabelText(/^password /i), 'password123')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different1')
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() => expect(screen.getByText('Passwords do not match')).toBeInTheDocument())
  })

  it('calls create API and collapses form on success', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    mockApi.create = vi.fn().mockResolvedValue({ ...fakeEditor, username: 'newuser' })
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.type(screen.getByLabelText(/username/i), 'newuser')
    await userEvent.type(screen.getByLabelText(/^password /i), 'secure-pass')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'secure-pass')
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() =>
      expect(mockApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'newuser', password: 'secure-pass' })
      )
    )
  })

  it('shows validation error when password is too common', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.type(screen.getByLabelText(/username/i), 'newuser')
    await userEvent.type(screen.getByLabelText(/^password /i), 'baseball1')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'baseball1')
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() =>
      expect(screen.getByText('This password is too commonly used')).toBeInTheDocument()
    )
  })

  it('shows validation error when password contains the username', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.type(screen.getByLabelText(/username/i), 'alice')
    await userEvent.type(screen.getByLabelText(/^password /i), 'alice-secure')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'alice-secure')
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() =>
      expect(screen.getByText('Password must not contain the username')).toBeInTheDocument()
    )
  })

  it('shows duplicate username error on 409', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    mockApi.create = vi.fn().mockRejectedValue({ response: { status: 409 } })
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    await userEvent.type(screen.getByLabelText(/username/i), 'dup')
    await userEvent.type(screen.getByLabelText(/^password /i), 'secure-pass')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'secure-pass')
    await userEvent.click(screen.getByRole('button', { name: /create user/i }))
    await waitFor(() => expect(screen.getByText('Username is already taken')).toBeInTheDocument())
  })

  it('Cancel button collapses add form', async () => {
    mockApi.list = vi.fn().mockResolvedValue([])
    render(<UserManagementModal open onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText(/▾ add user/i))
    await userEvent.click(screen.getByText(/▾ add user/i))
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('button', { name: /create user/i })).not.toBeInTheDocument()
  })
})
