import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../../App'

vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn().mockRejectedValue({ response: { status: 401 } }),
    post: vi.fn(),
  },
}))

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

describe('App', () => {
  it('shows login page when unauthenticated', async () => {
    render(<App />, { wrapper: makeWrapper() })
    // /auth/me returns 401 → app shows login form
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
  })
})
