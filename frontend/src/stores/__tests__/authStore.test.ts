import { useAuthStore } from '../authStore'

const mockUser = { username: 'alice', display_name: 'Alice', is_admin: false }

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
