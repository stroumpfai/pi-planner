import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreatePIModal } from '../CreatePIModal'
import { useCreatePI } from '@/hooks/usePIs'

vi.mock('@/hooks/usePIs')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()
const onClose = vi.fn()
const defaultProps = { open: true, projectId: 'p-1', onClose }

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue(undefined)
  vi.mocked(useCreatePI).mockReturnValue({
    mutateAsync, isPending: false,
  } as unknown as ReturnType<typeof useCreatePI>)
})

describe('CreatePIModal', () => {
  it('renders the New PI title and an empty form', () => {
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('New PI')).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('')
    expect(screen.getByLabelText(/start date/i)).toHaveValue('')
    expect(screen.getByLabelText(/end date/i)).toHaveValue('')
  })

  it('requires a name', async () => {
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /create pi/i }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('sends blank optional fields as null', async () => {
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Q2-2026')
    await userEvent.click(screen.getByRole('button', { name: /create pi/i }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Q2-2026',
        description: null,
        start_date: null,
        end_date: null,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('converts both dd.mm.yyyy dates to ISO', async () => {
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/name/i), 'Q2-2026')
    await userEvent.type(screen.getByLabelText(/description/i), 'Second increment')
    await userEvent.type(screen.getByLabelText(/start date/i), '01.04.2026')
    await userEvent.type(screen.getByLabelText(/end date/i), '30.06.2026')
    await userEvent.tab()   // DateInput emits on blur
    await userEvent.click(screen.getByRole('button', { name: /create pi/i }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        name: 'Q2-2026',
        description: 'Second increment',
        start_date: '2026-04-01',
        end_date: '2026-06-30',
      }),
    )
  })

  it('shows the single-in-progress message on ACTIVE_PI_EXISTS and stays open', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { error: 'ACTIVE_PI_EXISTS' } } },
    })
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/name/i), 'Q2-2026')
    await userEvent.click(screen.getByRole('button', { name: /create pi/i }))

    expect(await screen.findByText(/close the current in progress pi/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('swallows an unrecognised error without closing or showing the PI-state message', async () => {
    mutateAsync.mockRejectedValue({ response: { status: 500, data: {} } })
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/name/i), 'Q2-2026')
    await userEvent.click(screen.getByRole('button', { name: /create pi/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(screen.queryByText(/close the current in progress pi/i)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel closes without creating', async () => {
    render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Q2-2026')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('clears the form so a reopened modal starts blank', async () => {
    const { rerender } = render(<CreatePIModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Scratch')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    rerender(<CreatePIModal {...defaultProps} open={false} />)
    rerender(<CreatePIModal {...defaultProps} open />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('')
  })
})
