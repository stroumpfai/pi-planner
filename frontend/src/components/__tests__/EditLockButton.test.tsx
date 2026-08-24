import { vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditLockButton } from '../EditLockButton'
import {
  useEditLock,
  useAcquireEditLock,
  useReleaseEditLock,
  useKeepaliveEditLock,
} from '@/hooks/useEditLock'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

vi.mock('@/hooks/useEditLock')

const acquireMutate = vi.fn()
const releaseMutate = vi.fn()
const keepaliveMutate = vi.fn()

function setupHooks(lockData?: { is_locked: boolean; locked_by_username: string }) {
  vi.mocked(useEditLock).mockReturnValue({ data: lockData } as ReturnType<typeof useEditLock>)
  vi.mocked(useAcquireEditLock).mockReturnValue({
    mutate: acquireMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useAcquireEditLock>)
  vi.mocked(useReleaseEditLock).mockReturnValue({
    mutate: releaseMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useReleaseEditLock>)
  // A fresh object per call, like the real useMutation result. mockReturnValue would
  // hand back one frozen object and hide the identity churn the heartbeat depends on.
  vi.mocked(useKeepaliveEditLock).mockImplementation(
    () => ({ mutate: keepaliveMutate }) as unknown as ReturnType<typeof useKeepaliveEditLock>,
  )
}

const stamps = { created_at: '2026-08-10T09:00:00+00:00', last_login_at: null, password_changed_at: null }
const admin: User = { username: 'admin', display_name: null, role: 'admin', ...stamps }
const reader: User = { username: 'reader', display_name: null, role: 'reader', ...stamps }

beforeEach(() => {
  vi.clearAllMocks()
  setupHooks()
  useAuthStore.setState({ user: null, isEditing: false })
})

describe('EditLockButton', () => {
  it('renders nothing when no user', () => {
    const { container } = render(<EditLockButton projectId="p-1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Request Edit Mode when admin and no lock', () => {
    useAuthStore.setState({ user: admin, isEditing: false })
    render(<EditLockButton projectId="p-1" />)
    expect(screen.getByRole('button', { name: /request edit mode/i })).toBeInTheDocument()
  })

  it('shows You • Editor and Release button when admin is editing', () => {
    useAuthStore.setState({ user: admin, isEditing: true })
    render(<EditLockButton projectId="p-1" />)
    expect(screen.getByText(/you.*editor/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument()
  })

  it('shows Locked by when admin and lock held by another user', () => {
    setupHooks({ is_locked: true, locked_by_username: 'alice' })
    useAuthStore.setState({ user: admin, isEditing: false })
    render(<EditLockButton projectId="p-1" />)
    expect(screen.getByText(/locked by alice/i)).toBeInTheDocument()
  })

  it('renders nothing when non-admin and no lock', () => {
    useAuthStore.setState({ user: reader, isEditing: false })
    const { container } = render(<EditLockButton projectId="p-1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Locked by when non-admin and lock held by another user', () => {
    setupHooks({ is_locked: true, locked_by_username: 'alice' })
    useAuthStore.setState({ user: reader, isEditing: false })
    render(<EditLockButton projectId="p-1" />)
    expect(screen.getByText(/locked by alice/i)).toBeInTheDocument()
  })

  it('calls acquire.mutate when Request Edit Mode is clicked', async () => {
    useAuthStore.setState({ user: admin, isEditing: false })
    render(<EditLockButton projectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /request edit mode/i }))
    expect(acquireMutate).toHaveBeenCalledOnce()
  })

  it('calls release.mutate when Release is clicked', async () => {
    useAuthStore.setState({ user: admin, isEditing: true })
    render(<EditLockButton projectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /release/i }))
    expect(releaseMutate).toHaveBeenCalledOnce()
  })
})

describe('EditLockButton heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not send a keepalive when not editing', () => {
    useAuthStore.setState({ user: admin, isEditing: false })
    render(<EditLockButton projectId="p-1" />)
    vi.advanceTimersByTime(5 * 60_000)
    expect(keepaliveMutate).not.toHaveBeenCalled()
  })

  it('sends a keepalive every minute while editing', () => {
    useAuthStore.setState({ user: admin, isEditing: true })
    render(<EditLockButton projectId="p-1" />)

    vi.advanceTimersByTime(59_000)
    expect(keepaliveMutate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(keepaliveMutate).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(60_000)
    expect(keepaliveMutate).toHaveBeenCalledTimes(2)
  })

  it('keeps beating across the re-renders useEditLock\'s 30s refetch causes', () => {
    // Regression: the effect used to depend on the whole mutation result, which React
    // Query rebuilds every render. A re-render more often than once a minute restarted
    // the interval forever, so the lock expired under an actively editing user.
    useAuthStore.setState({ user: admin, isEditing: true })
    const { rerender } = render(<EditLockButton projectId="p-1" />)

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30_000)
      rerender(<EditLockButton projectId="p-1" />)
    }

    expect(keepaliveMutate).toHaveBeenCalledTimes(5)
  })

  it('stops beating once editing ends', () => {
    useAuthStore.setState({ user: admin, isEditing: true })
    const { rerender } = render(<EditLockButton projectId="p-1" />)
    vi.advanceTimersByTime(60_000)
    expect(keepaliveMutate).toHaveBeenCalledOnce()

    act(() => useAuthStore.setState({ isEditing: false }))
    rerender(<EditLockButton projectId="p-1" />)
    vi.advanceTimersByTime(5 * 60_000)
    expect(keepaliveMutate).toHaveBeenCalledOnce()
  })
})
