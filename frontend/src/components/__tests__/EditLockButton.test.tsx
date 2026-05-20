import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

function setupHooks(lockData?: { is_locked: boolean; locked_by_username: string }) {
  vi.mocked(useEditLock).mockReturnValue({ data: lockData } as ReturnType<typeof useEditLock>)
  vi.mocked(useAcquireEditLock).mockReturnValue({
    mutate: acquireMutate,
    isPending: false,
  } as ReturnType<typeof useAcquireEditLock>)
  vi.mocked(useReleaseEditLock).mockReturnValue({
    mutate: releaseMutate,
    isPending: false,
  } as ReturnType<typeof useReleaseEditLock>)
  vi.mocked(useKeepaliveEditLock).mockReturnValue({
    mutate: vi.fn(),
  } as ReturnType<typeof useKeepaliveEditLock>)
}

const admin: User = { username: 'admin', display_name: null, is_admin: true }
const reader: User = { username: 'reader', display_name: null, is_admin: false }

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
