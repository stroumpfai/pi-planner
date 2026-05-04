import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIStateButton } from '../PIStateButton'
import type { PI } from '@/types'

vi.mock('@/services/pis', () => ({
  pisApi: { update: vi.fn(), list: vi.fn().mockResolvedValue([]) },
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const makePI = (state: PI['state']): PI => ({
  system_id: 'pi-1',
  project_id: 'p-1',
  name: 'Q1',
  description: null,
  state,
  start_date: null,
  end_date: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
})

describe('PIStateButton', () => {
  it('shows "Start PI" for draft state', () => {
    render(<PIStateButton pi={makePI('draft')} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /start pi/i })).toBeInTheDocument()
  })

  it('shows "Close PI" for in_progress state', () => {
    render(<PIStateButton pi={makePI('in_progress')} projectId="p-1" />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /close pi/i })).toBeInTheDocument()
  })

  it('renders nothing for closed state', () => {
    const { container } = render(
      <PIStateButton pi={makePI('closed')} projectId="p-1" />,
      { wrapper: makeWrapper() },
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows confirmation dialog when Start PI clicked', async () => {
    render(<PIStateButton pi={makePI('draft')} projectId="p-1" />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /start pi/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
