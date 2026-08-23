import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserManagementModal } from '../UserManagementModal'
import * as usersService from '@/services/users'
import * as apiKeysService from '@/services/apiKeys'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import type { ApiKey, ApiKeyCreateResponse, User } from '@/types'

vi.mock('@/services/users')
vi.mock('@/services/apiKeys')
const mockUsers = vi.mocked(usersService.usersApi)
const mockKeys = vi.mocked(apiKeysService.apiKeysApi)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message)

function makeUser(over: Partial<User> = {}): User {
  return {
    username: 'admin',
    display_name: 'Administrator',
    role: 'admin',
    created_at: '2026-08-10T09:00:00+00:00',
    last_login_at: '2026-08-17T16:05:00+00:00',
    password_changed_at: '2026-08-12T11:30:00+00:00',
    ...over,
  }
}

const editor = makeUser({ username: 'alice', display_name: 'Alice', role: 'editor' })
const reader = makeUser({ username: 'bob', display_name: 'Bob', role: 'reader' })

function makeKey(over: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    username: 'admin',
    name: 'Claude MCP',
    purpose: null,
    created_at: '2026-08-01T10:00:00+00:00',
    expires_at: null,
    last_used_at: null,
    is_active: true,
    ...over,
  }
}

function makeToken(over: Partial<ApiKeyCreateResponse> = {}): ApiKeyCreateResponse {
  return {
    id: 'key-1',
    full_token: 'pik_secret_abc123',
    username: 'admin',
    name: 'Claude MCP',
    created_at: '2026-08-23T10:00:00+00:00',
    expires_at: null,
    ...over,
  }
}

// The reveal panel's Copy button is the only consumer of navigator.clipboard, which
// jsdom does not provide. userEvent never touches it unless copy/cut/paste is used.
function stubClipboard(writeText: () => Promise<void>) {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
  })
  return spy
}

/** Render the modal and switch to the API Keys tab. */
async function openKeysTab() {
  render(<UserManagementModal open onClose={vi.fn()} />, { wrapper: makeWrapper() })
  await userEvent.click(screen.getByRole('tab', { name: /api keys/i }))
}

/** The most recently portalled dialog — a ConfirmDialog or the reveal panel. */
function topDialog() {
  const dialogs = screen.getAllByRole('dialog')
  return dialogs[dialogs.length - 1]
}

describe('UserManagementModal — API Keys tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'admin', display_name: 'Administrator', role: 'admin' } })
    useToastStore.setState({ toasts: [] })
    mockUsers.list = vi.fn().mockResolvedValue([makeUser()])
    mockKeys.listAll = vi.fn().mockResolvedValue([])
  })

  // ── Tab gating ──────────────────────────────────────────────────────────────

  it('shows "Admin only" and never fetches keys for a non-admin', async () => {
    useAuthStore.setState({ user: { username: 'alice', display_name: 'Alice', role: 'editor' } })
    await openKeysTab()

    expect(await screen.findByText('Admin only')).toBeInTheDocument()
    expect(mockKeys.listAll).not.toHaveBeenCalled()
  })

  it('shows a loading state while the keys load', async () => {
    mockKeys.listAll = vi.fn().mockReturnValue(new Promise(() => {}))
    await openKeysTab()

    expect(await screen.findByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error with a working Retry when the key list fails', async () => {
    mockKeys.listAll = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([makeKey({ name: 'Recovered Key' })])
    await openKeysTab()

    expect(await screen.findByText('Failed to load API keys.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByText('Recovered Key')).toBeInTheDocument()
  })

  // ── Grouping by user ────────────────────────────────────────────────────────

  it('lists admin and editor users only', async () => {
    mockUsers.list = vi.fn().mockResolvedValue([makeUser(), editor, reader])
    await openKeysTab()

    expect(await screen.findByText('Administrator (admin)')).toBeInTheDocument()
    expect(screen.getByText('Alice (alice)')).toBeInTheDocument()
    expect(screen.queryByText(/\(bob\)/)).not.toBeInTheDocument()
  })

  it('falls back to the username when a user has no display name', async () => {
    mockUsers.list = vi.fn().mockResolvedValue([makeUser({ display_name: null })])
    await openKeysTab()

    expect(await screen.findByText('admin')).toBeInTheDocument()
  })

  it('says so when no user is eligible for a key', async () => {
    mockUsers.list = vi.fn().mockResolvedValue([reader])
    await openKeysTab()

    expect(await screen.findByText('No admin or editor users found.')).toBeInTheDocument()
  })

  it('shows "No keys" for a user without any', async () => {
    await openKeysTab()

    expect(await screen.findByText('No keys')).toBeInTheDocument()
  })

  it('hides revoked keys', async () => {
    mockKeys.listAll = vi.fn().mockResolvedValue([makeKey({ name: 'Old Key', is_active: false })])
    await openKeysTab()

    expect(await screen.findByText('No keys')).toBeInTheDocument()
    expect(screen.queryByText('Old Key')).not.toBeInTheDocument()
  })

  it('shows only the keys belonging to each user', async () => {
    mockUsers.list = vi.fn().mockResolvedValue([makeUser(), editor])
    mockKeys.listAll = vi.fn().mockResolvedValue([makeKey({ id: 'k1', name: 'Admin Key' })])
    await openKeysTab()

    expect(await screen.findByText('Admin Key')).toBeInTheDocument()
    // alice has none, so exactly one "No keys" placeholder is rendered
    expect(screen.getAllByText('No keys')).toHaveLength(1)
  })

  // ── Key card metadata ───────────────────────────────────────────────────────

  it('renders name, purpose and a never-expiring lifetime', async () => {
    mockKeys.listAll = vi
      .fn()
      .mockResolvedValue([makeKey({ purpose: 'Agent automation', expires_at: null })])
    await openKeysTab()

    expect(await screen.findByText('Claude MCP')).toBeInTheDocument()
    expect(screen.getByText('Agent automation')).toBeInTheDocument()
    expect(screen.getByText(/Never expires/)).toBeInTheDocument()
  })

  it('renders an expiry date when the key has one', async () => {
    mockKeys.listAll = vi.fn().mockResolvedValue([makeKey({ expires_at: '2026-11-01T10:00:00+00:00' })])
    await openKeysTab()

    expect(await screen.findByText(/Expires: Nov \d+, 2026/)).toBeInTheDocument()
  })

  it('formats last-used stamps relative to now', async () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    mockKeys.listAll = vi.fn().mockResolvedValue([
      makeKey({ id: 'k1', name: 'Fresh', last_used_at: ago(30_000) }),
      makeKey({ id: 'k2', name: 'Minute', last_used_at: ago(60_000) }),
      makeKey({ id: 'k3', name: 'Minutes', last_used_at: ago(5 * 60_000) }),
      makeKey({ id: 'k4', name: 'Hour', last_used_at: ago(90 * 60_000) }),
      makeKey({ id: 'k5', name: 'Days', last_used_at: ago(3 * 24 * 60 * 60_000) }),
    ])
    await openKeysTab()

    expect(await screen.findByText('Last used: just now')).toBeInTheDocument()
    expect(screen.getByText('Last used: 1 minute ago')).toBeInTheDocument()
    expect(screen.getByText('Last used: 5 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('Last used: 1 hour ago')).toBeInTheDocument()
    expect(screen.getByText('Last used: 3 days ago')).toBeInTheDocument()
  })

  it('omits the last-used line for a key never used', async () => {
    mockKeys.listAll = vi.fn().mockResolvedValue([makeKey({ last_used_at: null })])
    await openKeysTab()

    await screen.findByText('Claude MCP')
    expect(screen.queryByText(/Last used:/)).not.toBeInTheDocument()
  })

  // ── Issuing a key ───────────────────────────────────────────────────────────

  async function openIssueForm() {
    await openKeysTab()
    await userEvent.click(await screen.findByRole('button', { name: /issue key/i }))
  }

  it('reveals the issue form and hides the toggle while it is open', async () => {
    await openIssueForm()

    expect(screen.getByText('Issue key for admin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\+ issue key/i })).not.toBeInTheDocument()
  })

  it('requires a name', async () => {
    await openIssueForm()
    await userEvent.click(screen.getByRole('button', { name: /^issue key$/i }))

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(mockKeys.create).not.toHaveBeenCalled()
  })

  it('creates a key with the default 90-day expiry', async () => {
    mockKeys.create = vi.fn().mockResolvedValue(makeToken())
    await openIssueForm()
    await userEvent.type(screen.getByLabelText(/^name/i), 'Claude MCP')
    await userEvent.type(screen.getByLabelText(/purpose/i), 'Agent automation')
    await userEvent.click(screen.getByRole('button', { name: /^issue key$/i }))

    await waitFor(() =>
      expect(mockKeys.create).toHaveBeenCalledWith({
        username: 'admin',
        name: 'Claude MCP',
        purpose: 'Agent automation',
        expires_in_days: 90,
      })
    )
  })

  it('sends no expiry for "Never" and no purpose when blank', async () => {
    mockKeys.create = vi.fn().mockResolvedValue(makeToken())
    await openIssueForm()
    await userEvent.type(screen.getByLabelText(/^name/i), 'Forever Key')
    await userEvent.selectOptions(screen.getByLabelText(/expires in/i), 'never')
    await userEvent.click(screen.getByRole('button', { name: /^issue key$/i }))

    await waitFor(() =>
      expect(mockKeys.create).toHaveBeenCalledWith({
        username: 'admin',
        name: 'Forever Key',
        purpose: undefined,
        expires_in_days: undefined,
      })
    )
  })

  it('parses a non-default expiry into a number', async () => {
    mockKeys.create = vi.fn().mockResolvedValue(makeToken())
    await openIssueForm()
    await userEvent.type(screen.getByLabelText(/^name/i), 'Short Key')
    await userEvent.selectOptions(screen.getByLabelText(/expires in/i), '30')
    await userEvent.click(screen.getByRole('button', { name: /^issue key$/i }))

    await waitFor(() =>
      expect(mockKeys.create).toHaveBeenCalledWith(expect.objectContaining({ expires_in_days: 30 }))
    )
  })

  it('toasts and reveals nothing when creation fails', async () => {
    mockKeys.create = vi.fn().mockRejectedValue(new Error('boom'))
    await openIssueForm()
    await userEvent.type(screen.getByLabelText(/^name/i), 'Doomed Key')
    await userEvent.click(screen.getByRole('button', { name: /^issue key$/i }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to create API key'))
    expect(screen.queryByText('API Key Created')).not.toBeInTheDocument()
  })

  it('cancelling the issue form brings the toggle back', async () => {
    await openIssueForm()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByText('Issue key for admin')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ issue key/i })).toBeInTheDocument()
  })

  // ── Secret reveal panel ─────────────────────────────────────────────────────

  async function issueKeySuccessfully(token = makeToken()) {
    mockKeys.create = vi.fn().mockResolvedValue(token)
    await openIssueForm()
    await userEvent.type(screen.getByLabelText(/^name/i), 'Claude MCP')
    await userEvent.click(screen.getByRole('button', { name: /^issue key$/i }))
    await screen.findByText('API Key Created')
  }

  it('reveals the secret once and dismisses it on confirmation', async () => {
    await issueKeySuccessfully()

    expect(screen.getByText('pik_secret_abc123')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /copied it/i }))

    await waitFor(() => expect(screen.queryByText('API Key Created')).not.toBeInTheDocument())
  })

  it('does not let Escape dismiss the secret', async () => {
    await issueKeySuccessfully()
    await userEvent.keyboard('{Escape}')

    expect(screen.getByText('pik_secret_abc123')).toBeInTheDocument()
  })

  it('copies the secret to the clipboard', async () => {
    const writeText = stubClipboard(() => Promise.resolve())
    await issueKeySuccessfully()
    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }))

    expect(writeText).toHaveBeenCalledWith('pik_secret_abc123')
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('toasts when the clipboard write is refused', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    await issueKeySuccessfully()
    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to copy to clipboard'))
    expect(screen.queryByRole('button', { name: 'Copied!' })).not.toBeInTheDocument()
  })

  // ── Cycling and revoking ────────────────────────────────────────────────────

  async function openTabWithOneKey() {
    mockKeys.listAll = vi.fn().mockResolvedValue([makeKey()])
    await openKeysTab()
    await screen.findByText('Claude MCP')
  }

  it('cycling asks first, then reveals the replacement secret', async () => {
    mockKeys.cycle = vi.fn().mockResolvedValue(makeToken({ full_token: 'pik_secret_rotated' }))
    await openTabWithOneKey()
    await userEvent.click(screen.getByRole('button', { name: /cycle/i }))

    expect(screen.getByText('Cycle this key?')).toBeInTheDocument()
    await userEvent.click(within(topDialog()).getByRole('button', { name: /cycle key/i }))

    await waitFor(() => expect(mockKeys.cycle).toHaveBeenCalledWith('key-1'))
    expect(await screen.findByText('pik_secret_rotated')).toBeInTheDocument()
  })

  it('cancelling the cycle prompt calls nothing', async () => {
    mockKeys.cycle = vi.fn()
    await openTabWithOneKey()
    await userEvent.click(screen.getByRole('button', { name: /cycle/i }))
    await userEvent.click(within(topDialog()).getByRole('button', { name: /cancel/i }))

    expect(mockKeys.cycle).not.toHaveBeenCalled()
    expect(screen.queryByText('Cycle this key?')).not.toBeInTheDocument()
  })

  it('toasts when cycling fails', async () => {
    mockKeys.cycle = vi.fn().mockRejectedValue(new Error('boom'))
    await openTabWithOneKey()
    await userEvent.click(screen.getByRole('button', { name: /cycle/i }))
    await userEvent.click(within(topDialog()).getByRole('button', { name: /cycle key/i }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to cycle key'))
  })

  it('revoking asks first, then reports the revoked key by name', async () => {
    mockKeys.revoke = vi.fn().mockResolvedValue(undefined)
    await openTabWithOneKey()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))

    expect(screen.getByText('Revoke this key?')).toBeInTheDocument()
    await userEvent.click(within(topDialog()).getByRole('button', { name: /^revoke$/i }))

    await waitFor(() => expect(mockKeys.revoke).toHaveBeenCalledWith('key-1'))
    await waitFor(() => expect(toastMessages()).toContain('Revoked key "Claude MCP"'))
  })

  it('cancelling the revoke prompt calls nothing', async () => {
    mockKeys.revoke = vi.fn()
    await openTabWithOneKey()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await userEvent.click(within(topDialog()).getByRole('button', { name: /cancel/i }))

    expect(mockKeys.revoke).not.toHaveBeenCalled()
  })

  it('toasts when revoking fails', async () => {
    mockKeys.revoke = vi.fn().mockRejectedValue(new Error('boom'))
    await openTabWithOneKey()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await userEvent.click(within(topDialog()).getByRole('button', { name: /^revoke$/i }))

    await waitFor(() => expect(toastMessages()).toContain('Failed to revoke key'))
  })
})
