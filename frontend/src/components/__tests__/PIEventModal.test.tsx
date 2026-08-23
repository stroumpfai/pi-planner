import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PIEventModal } from '../PIEventModal'
import { useCreatePIEvent, useDeletePIEvent, useUpdatePIEvent } from '@/hooks/usePIEvents'
import type { PIEvent } from '@/types'

vi.mock('@/hooks/usePIEvents')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()
const deleteMutateAsync = vi.fn()

const fakeEvent: PIEvent = {
  system_id: 'ev-1',
  pi_id: 'pi-1',
  name: 'Release v2.0',
  event_date: '2026-03-05',
  event_type: 'release',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const onClose = vi.fn()
const defaultProps = { open: true, piId: 'pi-1', onClose }

/** Mock the three mutation hooks; `pending` flips isPending on all of them at once. */
const mockHooks = (pending = false) => {
  vi.mocked(useCreatePIEvent).mockReturnValue({
    mutateAsync: createMutateAsync, isPending: pending,
  } as unknown as ReturnType<typeof useCreatePIEvent>)
  vi.mocked(useUpdatePIEvent).mockReturnValue({
    mutateAsync: updateMutateAsync, isPending: pending,
  } as unknown as ReturnType<typeof useUpdatePIEvent>)
  vi.mocked(useDeletePIEvent).mockReturnValue({
    mutateAsync: deleteMutateAsync, isPending: pending,
  } as unknown as ReturnType<typeof useDeletePIEvent>)
}

beforeEach(() => {
  vi.clearAllMocks()
  createMutateAsync.mockResolvedValue(undefined)
  updateMutateAsync.mockResolvedValue(undefined)
  deleteMutateAsync.mockResolvedValue(undefined)
  mockHooks()
})

describe('PIEventModal', () => {
  it('renders the Add Event title when creating', () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Add Event')).toBeInTheDocument()
  })

  it('renders the Edit Event title and pre-fills the fields when editing', () => {
    render(<PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Edit Event')).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Release v2.0')
    expect(screen.getByLabelText(/date/i)).toHaveValue('05.03.2026')
    expect(screen.getByLabelText(/type/i)).toHaveValue('release')
  })

  it('defaults a new event to the milestone type', () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByLabelText(/type/i)).toHaveValue('milestone')
  })

  // ── Validation ───────────────────────────────────────────────────────────────

  it('rejects a blank name without calling the mutation', async () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only name', async () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), '   ')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('rejects a missing date without calling the mutation', async () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })
    await userEvent.type(screen.getByLabelText(/name/i), 'Kickoff')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText('Date is required')).toBeInTheDocument()
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  // ── Create ───────────────────────────────────────────────────────────────────

  it('creates an event with a trimmed name, ISO date and chosen type', async () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/name/i), '  Kickoff  ')
    await userEvent.type(screen.getByLabelText(/date/i), '05.03.2026')
    await userEvent.tab()   // DateInput only emits on blur
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'deadline')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith({
        name: 'Kickoff',
        event_date: '2026-03-05',
        event_type: 'deadline',
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a save error and stays open when creating fails', async () => {
    createMutateAsync.mockRejectedValue(new Error('boom'))
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.type(screen.getByLabelText(/name/i), 'Kickoff')
    await userEvent.type(screen.getByLabelText(/date/i), '05.03.2026')
    await userEvent.tab()
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(await screen.findByText('Failed to save event')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  // ── Update ───────────────────────────────────────────────────────────────────

  it('updates an existing event with its system_id and the edited values', async () => {
    render(<PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() })

    await userEvent.clear(screen.getByLabelText(/name/i))
    await userEvent.type(screen.getByLabelText(/name/i), 'Release v2.1')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({
        eventId: 'ev-1',
        body: { name: 'Release v2.1', event_date: '2026-03-05', event_type: 'release' },
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  // ── Delete ───────────────────────────────────────────────────────────────────

  it('has no Delete button when creating', () => {
    render(<PIEventModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('requires a second click to confirm a delete', async () => {
    render(<PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm delete\?/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /confirm delete\?/i }))
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('ev-1'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a delete error and stays open when deleting fails', async () => {
    deleteMutateAsync.mockRejectedValue(new Error('boom'))
    render(<PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() })

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm delete\?/i }))

    expect(await screen.findByText('Failed to delete event')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  // ── Pending and close ────────────────────────────────────────────────────────

  it('disables the actions and shows Saving… while a mutation is pending', () => {
    mockHooks(true)
    render(<PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /saving…/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
  })

  it('Cancel closes without mutating', async () => {
    render(<PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('discards edits so a reopened modal shows the stored values again', async () => {
    const { rerender } = render(
      <PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() },
    )

    await userEvent.clear(screen.getByLabelText(/name/i))
    await userEvent.type(screen.getByLabelText(/name/i), 'Scratch edit')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    rerender(<PIEventModal {...defaultProps} open={false} event={fakeEvent} />)
    rerender(<PIEventModal {...defaultProps} open event={fakeEvent} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Release v2.0')
  })

  it('re-syncs the fields when a different event is loaded into an open modal', () => {
    const { rerender } = render(
      <PIEventModal {...defaultProps} event={fakeEvent} />, { wrapper: makeWrapper() },
    )
    expect(screen.getByLabelText(/name/i)).toHaveValue('Release v2.0')

    const other: PIEvent = { ...fakeEvent, system_id: 'ev-2', name: 'Pilot start', event_type: 'pilot' }
    rerender(<PIEventModal {...defaultProps} event={other} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Pilot start')
    expect(screen.getByLabelText(/type/i)).toHaveValue('pilot')
  })
})
