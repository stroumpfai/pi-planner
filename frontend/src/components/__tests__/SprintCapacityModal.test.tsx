import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SprintCapacityModal } from '../SprintCapacityModal'
import { useUpdateSprint } from '@/hooks/useSprints'
import type { Sprint } from '@/types'

vi.mock('@/hooks/useSprints')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const fakeSprint: Sprint = {
  system_id: 's-1',
  pi_id: 'pi-1',
  sprint_index: 1,
  capacity: 10,
  start_date: null,
  end_date: null,
  effort: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const defaultProps = {
  open: true,
  sprint: fakeSprint,
  piId: 'pi-1',
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useUpdateSprint).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateSprint>)
})

describe('SprintCapacityModal', () => {
  it('renders the sprint label in the title', () => {
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText(/edit sprint 2/i)).toBeInTheDocument()
  })

  it('shows the current capacity value in the input', () => {
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('spinbutton')).toHaveValue(10)
  })

  it('submitting calls mutateAsync with the new capacity', async () => {
    mutateAsync.mockResolvedValue({})
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '20')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: 's-1', body: expect.objectContaining({ capacity: 20 }) }),
    )
  })

  it('shows validation error when capacity is cleared (NaN)', async () => {
    // min="0" on the number input stops HTML5 form submission for negative values,
    // but an empty value (parseInt → NaN) passes HTML5 validation and hits our check.
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/capacity must be 0 or greater/i)).toBeInTheDocument(),
    )
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('shows fallback error when mutation fails', async () => {
    mutateAsync.mockRejectedValue(new Error('Server error'))
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/failed to update sprint/i)).toBeInTheDocument(),
    )
  })
})
