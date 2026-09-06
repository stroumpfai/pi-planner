import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SprintCapacityModal } from '../SprintCapacityModal'
import { useUpdateSprint } from '@/hooks/useSprints'
import type { ProjectPushStatus, Sprint } from '@/types'

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
  available: 10,
  start_date: null,
  end_date: null,
  effort: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const derivedStatus = (over: Partial<ProjectPushStatus> = {}): ProjectPushStatus => ({
  project_id: 'p-1',
  project_name: 'ISK Portal',
  team_id: 't-1',
  team_name: 'Platform',
  share_pct: 70,
  available_source: 'factor',
  stale_sprints: 0,
  last_pushed_at: '2026-04-20T09:30:00Z',
  ...over,
})

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

  it('shows the current Available value in the input', () => {
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('spinbutton')).toHaveValue(10)
  })

  it('submitting calls mutateAsync with the new Available', async () => {
    mutateAsync.mockResolvedValue({})
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.type(input, '20')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sprintId: 's-1', body: expect.objectContaining({ available: 20 }) }),
    )
  })

  it('shows validation error when Available is cleared (NaN)', async () => {
    // min="0" on the number input stops HTML5 form submission for negative values,
    // but an empty value (parseInt → NaN) passes HTML5 validation and hits our check.
    render(<SprintCapacityModal {...defaultProps} />, { wrapper: makeWrapper() })
    const input = screen.getByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/available must be 0 or greater/i)).toBeInTheDocument(),
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
  // ── A derived Available is read-only here (teams.md §6.4) ──────────────────

  it('locks Available and names the team it came from', () => {
    render(
      <SprintCapacityModal
        {...defaultProps}
        sprint={{ ...fakeSprint, available: 21, available_pushed_at: '2026-04-20T09:30:00Z' }}
        pushStatus={derivedStatus()}
      />,
      { wrapper: makeWrapper() },
    )

    expect(screen.getByLabelText(/^Available/)).toHaveAttribute('readonly')
    expect(screen.getByText(/Derived from team Platform/)).toBeInTheDocument()
    expect(screen.getByText(/pushed Apr 20, 2026/)).toBeInTheDocument()
  })

  it('saves the dates without touching Available on a derived sprint', async () => {
    // Sending the value back unchanged would still be a write the API refuses
    // with 409 AVAILABLE_IS_DERIVED, so the field is left out of the body.
    mutateAsync.mockResolvedValue({})
    render(
      <SprintCapacityModal
        {...defaultProps}
        sprint={{ ...fakeSprint, available: 21 }}
        pushStatus={derivedStatus()}
      />,
      { wrapper: makeWrapper() },
    )

    await userEvent.type(screen.getByLabelText('Start date'), '06.04.2026')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync.mock.calls[0][0].body).not.toHaveProperty('available')
    expect(mutateAsync.mock.calls[0][0].body.start_date).toBe('2026-04-06')
  })

  it('leaves Available editable on a manual project', () => {
    render(
      <SprintCapacityModal {...defaultProps} pushStatus={derivedStatus({ available_source: 'manual' })} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByLabelText(/^Available/)).not.toHaveAttribute('readonly')
  })
})
