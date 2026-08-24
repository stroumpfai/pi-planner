import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoginPage } from '../LoginPage'
import { useLogin } from '@/hooks/useAuth'

vi.mock('@/hooks/useAuth')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useLogin).mockReturnValue({
    mutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useLogin>)
})

describe('LoginPage', () => {
  it('renders the Sign In button', () => {
    render(<LoginPage />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('submitting the form calls login.mutate with credentials', async () => {
    render(<LoginPage />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/username/i), 'admin')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', password: 'secret' }),
      ),
    )
  })

  it('shows error message when login fails', () => {
    vi.mocked(useLogin).mockReturnValue({
      mutate,
      isPending: false,
      error: new Error('Unauthorized'),
    } as unknown as ReturnType<typeof useLogin>)
    render(<LoginPage />, { wrapper: makeWrapper() })
    expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument()
  })
})
