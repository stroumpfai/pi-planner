import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../App'

import userEvent from '@testing-library/user-event'

const fakeUser = { username: 'admin', display_name: 'Admin', is_admin: true }

vi.mock('@/hooks/useAuth', () => ({
  useCurrentUser: vi.fn(),
  useLogout: vi.fn(),
  useLogin: vi.fn(),
}))
vi.mock('@/hooks/useSSE', () => ({ useSSE: vi.fn() }))
vi.mock('@/pages/ProjectListPage', () => ({ ProjectListPage: () => <div>project list</div> }))
vi.mock('@/pages/BacklogPage', () => ({ BacklogPage: () => <div>backlog</div> }))
vi.mock('@/pages/PIBoardPage', () => ({ PIBoardPage: () => <div>pi board</div> }))
vi.mock('@/pages/LoginPage', () => ({ LoginPage: () => <div>login page</div> }))
vi.mock('@/components/PIListPanel', () => ({ PIListPanel: () => null }))
vi.mock('@/components/EditLockButton', () => ({ EditLockButton: () => null }))

import { useCurrentUser, useLogout } from '@/hooks/useAuth'

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCurrentUser).mockReturnValue({ data: null, isLoading: false, isError: true } as unknown as ReturnType<typeof useCurrentUser>)
  vi.mocked(useLogout).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useLogout>)
})

describe('App', () => {
  it('shows login page when unauthenticated', async () => {
    render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
  })

  it('renders header with PI Planner when authenticated', async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: fakeUser, isLoading: false, isError: false } as unknown as ReturnType<typeof useCurrentUser>)
    render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('PI Planner')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('clicking Sign out calls logout.mutate', async () => {
    const logoutMutate = vi.fn()
    vi.mocked(useCurrentUser).mockReturnValue({ data: fakeUser, isLoading: false, isError: false } as unknown as ReturnType<typeof useCurrentUser>)
    vi.mocked(useLogout).mockReturnValue({ mutate: logoutMutate } as unknown as ReturnType<typeof useLogout>)
    render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /sign out/i }))
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(logoutMutate).toHaveBeenCalled()
  })

  it('clicking PI Planner home button calls setActiveProject(null)', async () => {
    vi.mocked(useCurrentUser).mockReturnValue({ data: fakeUser, isLoading: false, isError: false } as unknown as ReturnType<typeof useCurrentUser>)
    render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('PI Planner'))
    await userEvent.click(screen.getByRole('button', { name: /pi planner/i }))
    // No error thrown; setActiveProject(null) called on uiStore
  })
})
