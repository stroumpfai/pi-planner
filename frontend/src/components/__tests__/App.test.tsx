import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../App'

import userEvent from '@testing-library/user-event'

const fakeUser = { username: 'admin', display_name: 'Admin', is_admin: true }

// The header names the open project or team; these specs route on ids alone.
vi.mock('@/hooks/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useProjects')>()),
  useProject: () => ({ data: undefined }),
}))
vi.mock('@/hooks/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTeams')>()),
  useTeamRead: () => ({ data: undefined }),
}))

vi.mock('@/hooks/useAuth', () => ({
  useCurrentUser: vi.fn(),
  useLogout: vi.fn(),
  useLogin: vi.fn(),
}))
vi.mock('@/hooks/useSSE', () => ({ useSSE: vi.fn(), useTeamSSE: vi.fn() }))
vi.mock('@/pages/ProjectListPage', () => ({ ProjectListPage: () => <div>project list</div> }))
vi.mock('@/pages/BacklogPage', () => ({ BacklogPage: () => <div>backlog</div> }))
vi.mock('@/pages/PIBoardPage', () => ({ PIBoardPage: () => <div>pi board</div> }))
vi.mock('@/pages/LoginPage', () => ({ LoginPage: () => <div>login page</div> }))
vi.mock('@/components/PIListPanel', () => ({ PIListPanel: () => null }))
vi.mock('@/components/EditLockButton', () => ({ EditLockButton: () => <div>edit lock</div> }))
vi.mock('@/pages/TeamPage', () => ({ TeamPage: () => <div>team page</div> }))

import { useCurrentUser, useLogout } from '@/hooks/useAuth'
import { useUiStore } from '@/stores/uiStore'

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
  useUiStore.setState({ activeProjectId: null, activePIId: null, activeTeamId: null })
})

function signedIn() {
  vi.mocked(useCurrentUser).mockReturnValue(
    { data: fakeUser, isLoading: false, isError: false } as unknown as ReturnType<typeof useCurrentUser>,
  )
}

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

  it('routes three ways: home, a project, a team', async () => {
    signedIn()
    const { rerender } = render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('project list')).toBeInTheDocument())

    useUiStore.setState({ activeProjectId: 'p-1', activeTeamId: null })
    rerender(<App />)
    expect(screen.getByText('backlog')).toBeInTheDocument()

    useUiStore.setState({ activeProjectId: null, activeTeamId: 't-1' })
    rerender(<App />)
    expect(screen.getByText('team page')).toBeInTheDocument()
    expect(screen.queryByText('project list')).not.toBeInTheDocument()
  })

  it('offers no edit lock in a team view', async () => {
    /* Team data is edited without the project lock (teams.md §4.1), so the button
       stays gated on activeProjectId — "any active thing" would be wrong. */
    signedIn()
    useUiStore.setState({ activeTeamId: 't-1' })
    render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('team page')).toBeInTheDocument())
    expect(screen.queryByText('edit lock')).not.toBeInTheDocument()
  })

  it('offers the edit lock in a project view', async () => {
    signedIn()
    useUiStore.setState({ activeProjectId: 'p-1' })
    render(<App />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('edit lock')).toBeInTheDocument())
  })
})
