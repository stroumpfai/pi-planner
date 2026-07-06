import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SplitFeatureModal } from '../SplitFeatureModal'
import { usePIs } from '@/hooks/usePIs'
import { useSwimlinesForPI } from '@/hooks/useSwimlinesAndGroups'
import { useSplitFeature } from '@/hooks/useFeatures'

vi.mock('@/hooks/usePIs')
vi.mock('@/hooks/useSwimlinesAndGroups')
vi.mock('@/hooks/useFeatures')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const defaultProps = {
  open: true,
  projectId: 'p-1',
  featureId: 'f-1',
  currentPiId: 'pi-1',
  pbiIds: ['pbi-1', 'pbi-2'],
  onClose: vi.fn(),
}

const PIS = [
  { system_id: 'pi-1', project_id: 'p-1', name: 'PI 1', description: null, state: 'in_progress', start_date: null, end_date: null, created_at: '', modified_at: '', total_effort: 0, total_capacity: 0 },
  { system_id: 'pi-2', project_id: 'p-1', name: 'PI 2', description: null, state: 'draft', start_date: null, end_date: null, created_at: '', modified_at: '', total_effort: 0, total_capacity: 0 },
]

const SWIMLINES = [
  { system_id: 'sw-2a', pi_id: 'pi-2', name: 'Team Alpha', order_index: 0, created_at: '', modified_at: '', effort: 0, capacity: 0 },
  { system_id: 'sw-2b', pi_id: 'pi-2', name: 'Team Beta', order_index: 1, created_at: '', modified_at: '', effort: 0, capacity: 0 },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePIs).mockReturnValue({ data: PIS } as ReturnType<typeof usePIs>)
  vi.mocked(useSwimlinesForPI).mockReturnValue({ data: SWIMLINES } as ReturnType<typeof useSwimlinesForPI>)
  vi.mocked(useSplitFeature).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useSplitFeature>)
})

describe('SplitFeatureModal', () => {
  it('renders the Move to PI title and PBI count when open', () => {
    render(<SplitFeatureModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Move to PI')).toBeInTheDocument()
    expect(screen.getByText(/2 PBIs will move/i)).toBeInTheDocument()
  })

  it('excludes the current PI from the target PI dropdown', () => {
    render(<SplitFeatureModal {...defaultProps} />, { wrapper: makeWrapper() })
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).not.toContain('PI 1')
    expect(options).toContain('PI 2')
  })

  it('submit button is disabled until both PI and swimlane are chosen', async () => {
    render(<SplitFeatureModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('button', { name: /move 2 pbis/i })).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText(/target pi/i), 'pi-2')
    expect(screen.getByRole('button', { name: /move 2 pbis/i })).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText(/target swimline/i), 'sw-2b')
    expect(screen.getByRole('button', { name: /move 2 pbis/i })).not.toBeDisabled()
  })

  it('submitting calls the split mutation with the chosen target and pbiIds', async () => {
    mutateAsync.mockResolvedValue({})
    render(<SplitFeatureModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByLabelText(/target pi/i), 'pi-2')
    await userEvent.selectOptions(screen.getByLabelText(/target swimline/i), 'sw-2b')
    await userEvent.click(screen.getByRole('button', { name: /move 2 pbis/i }))

    expect(mutateAsync).toHaveBeenCalledWith({
      featureId: 'f-1',
      body: { target_pi_id: 'pi-2', target_swimline_id: 'sw-2b', pbi_ids: ['pbi-1', 'pbi-2'] },
    })
  })

  it('shows error message on mutation failure', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { message: 'Swimline does not belong to target PI' } } },
    })
    render(<SplitFeatureModal {...defaultProps} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByLabelText(/target pi/i), 'pi-2')
    await userEvent.selectOptions(screen.getByLabelText(/target swimline/i), 'sw-2b')
    await userEvent.click(screen.getByRole('button', { name: /move 2 pbis/i }))

    await waitFor(() =>
      expect(screen.getByText('Swimline does not belong to target PI')).toBeInTheDocument(),
    )
  })
})
