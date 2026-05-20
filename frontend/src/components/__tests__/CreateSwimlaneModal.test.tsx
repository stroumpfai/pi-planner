import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateSwimlaneModal } from '../CreateSwimlaneModal'
import { useCreateSwimline } from '@/hooks/useSwimlinesAndGroups'

vi.mock('@/hooks/useSwimlinesAndGroups')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const defaultProps = {
  open: true,
  piId: 'pi-1',
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCreateSwimline).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as ReturnType<typeof useCreateSwimline>)
})

describe('CreateSwimlaneModal', () => {
  it('renders the New Swimlane title when open', () => {
    render(<CreateSwimlaneModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New Swimlane')).toBeInTheDocument()
  })

  it('Create button is disabled when name is empty', () => {
    render(<CreateSwimlaneModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })

  it('submitting calls mutateAsync with the trimmed name', async () => {
    mutateAsync.mockResolvedValue({})
    render(<CreateSwimlaneModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), '  Team Alpha  ')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'Team Alpha' })
  })

  it('shows error message on 409 duplicate name', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { message: 'Swimlane name already exists' } } },
    })
    render(<CreateSwimlaneModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Team Alpha')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() =>
      expect(screen.getByText('Swimlane name already exists')).toBeInTheDocument(),
    )
  })

  it('shows fallback error message when no detail message', async () => {
    mutateAsync.mockRejectedValue(new Error('Network error'))
    render(<CreateSwimlaneModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Team Beta')
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
    await waitFor(() =>
      expect(screen.getByText('Failed to create swimlane')).toBeInTheDocument(),
    )
  })
})
