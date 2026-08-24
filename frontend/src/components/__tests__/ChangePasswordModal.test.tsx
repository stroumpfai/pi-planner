import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChangePasswordModal } from '../ChangePasswordModal'
import * as usersService from '@/services/users'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'

const stamps = { created_at: '2026-01-01T00:00:00Z', last_login_at: null, password_changed_at: null }

vi.mock('@/services/users')
const mockApi = vi.mocked(usersService.usersApi)

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const onClose = vi.fn()
const defaultProps = { open: true, onClose }

/** Fill all three fields; `confirm` defaults to matching the new password. */
async function fillForm(current: string, next: string, confirm = next) {
  await userEvent.type(screen.getByLabelText(/current password/i), current)
  await userEvent.type(screen.getByLabelText(/new password/i), next)
  await userEvent.type(screen.getByLabelText(/confirm password/i), confirm)
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /^save$/i }))

const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message)

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.changePassword = vi.fn().mockResolvedValue(undefined)
  useAuthStore.setState({ user: { username: 'alice', display_name: 'Alice', role: 'editor', ...stamps } })
  useToastStore.setState({ toasts: [] })
})

describe('ChangePasswordModal', () => {
  it('renders the three password fields', () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Change Password')).toBeInTheDocument()
    expect(screen.getByLabelText(/current password/i)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/new password/i)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute('type', 'password')
  })

  // ── Schema validation ────────────────────────────────────────────────────────

  it('requires the current password', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/new password/i), 'Str4ngeQuark!x')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'Str4ngeQuark!x')
    await submit()
    expect(await screen.findByText('Current password is required')).toBeInTheDocument()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })

  it('rejects a new password shorter than 12 characters', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'Short1!')
    await submit()
    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })

  it('rejects a confirmation that does not match', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'Str4ngeQuark!x', 'Str4ngeQuark!y')
    await submit()
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })

  // ── Password policy (mirrors the backend rules) ──────────────────────────────

  it('rejects a new password containing the username, case-insensitively', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'xxALICExx9922!')
    await submit()
    expect(await screen.findByText('Password must not contain your username')).toBeInTheDocument()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })

  it('rejects a new password relating to the application name', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'piplanner2026!')
    await submit()
    expect(await screen.findByText('Password must not relate to the application name'))
      .toBeInTheDocument()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })

  it('rejects a password from the common-password blocklist', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', '!qaz2wsx#edc')
    await submit()
    expect(await screen.findByText('This password is too commonly used')).toBeInTheDocument()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })

  it('accepts a password when the store has no user (no username rule to apply)', async () => {
    useAuthStore.setState({ user: null })
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'Str4ngeQuark!x')
    await submit()
    await waitFor(() => expect(mockApi.changePassword).toHaveBeenCalled())
  })

  // ── Submission ───────────────────────────────────────────────────────────────

  it('submits only the old and new passwords, then toasts and closes', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'Str4ngeQuark!x')
    await submit()

    await waitFor(() =>
      expect(mockApi.changePassword).toHaveBeenCalledWith({
        old_password: 'OldPassw0rd!x',
        new_password: 'Str4ngeQuark!x',
      }),
    )
    await waitFor(() => expect(toastMessages()).toContain('Password updated'))
    expect(onClose).toHaveBeenCalled()
  })

  it('flags the current password when the API rejects it with a 400', async () => {
    mockApi.changePassword = vi.fn().mockRejectedValue({ response: { status: 400 } })
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('WrongPassw0rd!', 'Str4ngeQuark!x')
    await submit()

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('toasts an error for a non-400 failure', async () => {
    mockApi.changePassword = vi.fn().mockRejectedValue({ response: { status: 500 } })
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'Str4ngeQuark!x')
    await submit()

    await waitFor(() => expect(toastMessages()).toContain('Failed to update password'))
    expect(onClose).not.toHaveBeenCalled()
  })

  // ── Strength bar and close ───────────────────────────────────────────────────

  it('shows the strength bar only once a new password is typed', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.queryByText(/very weak|weak|fair|good|strong/i)).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/new password/i), 'abc')
    expect(await screen.findByText(/very weak|weak/i)).toBeInTheDocument()
  })

  it('Cancel closes without calling the API', async () => {
    render(<ChangePasswordModal {...defaultProps} />, { wrapper: makeWrapper() })
    await fillForm('OldPassw0rd!x', 'Str4ngeQuark!x')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(mockApi.changePassword).not.toHaveBeenCalled()
  })
})
