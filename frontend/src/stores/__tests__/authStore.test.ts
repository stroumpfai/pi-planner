import { useAuthStore } from '../authStore'
import type { User } from '@/types'

const mockUser: User = {
  username: 'alice',
  display_name: 'Alice',
  role: 'editor',
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: null,
  password_changed_at: null,
}

describe('authStore', () => {
  beforeEach(() => useAuthStore.setState({ user: null, isEditing: false }))

  it('sets user on login', () => {
    useAuthStore.getState().setUser(mockUser)
    expect(useAuthStore.getState().user).toEqual(mockUser)
  })

  it('clears user on logout', () => {
    useAuthStore.setState({ user: mockUser })
    useAuthStore.getState().setUser(null)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('tracks edit mode', () => {
    useAuthStore.getState().setIsEditing(true)
    expect(useAuthStore.getState().isEditing).toBe(true)
  })
})
