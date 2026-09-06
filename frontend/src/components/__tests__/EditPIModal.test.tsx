import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditPIModal } from '../EditPIModal'
import { useUpdatePI } from '@/hooks/usePIs'
import { useSprints } from '@/hooks/useSprints'
import { useTeamCapacityStatus } from '@/hooks/useTeamPush'
import * as sprintsService from '@/services/sprints'
import type { PI, ProjectPushStatus, Sprint } from '@/types'

vi.mock('@/hooks/usePIs')
vi.mock('@/hooks/useSprints')
vi.mock('@/hooks/useTeamPush', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTeamPush')>()),
  useTeamCapacityStatus: vi.fn(),
}))
vi.mock('@/services/sprints', () => ({
  sprintsApi: { update: vi.fn(), list: vi.fn(), create: vi.fn() },
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const updateMutateAsync = vi.fn()

const fakePI: PI = {
  system_id: 'pi-1',
  project_id: 'p-1',
  name: 'Q1-2026',
  description: null,
  state: 'draft',
  start_date: null,
  end_date: null,
  total_effort: 0,
  total_available: 0,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

const fakeSprint: Sprint = {
  system_id: 's-1',
  pi_id: 'pi-1',
  sprint_index: 0,
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

/** No team serves this project unless a test says one does. */
const mockPushStatus = (statuses: ProjectPushStatus[] | undefined) =>
  vi.mocked(useTeamCapacityStatus).mockReturnValue({
    data: statuses,
  } as ReturnType<typeof useTeamCapacityStatus>)

const defaultProps = {
  open: true,
  pi: fakePI,
  projectId: 'p-1',
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useUpdatePI).mockReturnValue({
    mutateAsync: updateMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdatePI>)
  vi.mocked(useSprints).mockReturnValue({
    data: [fakeSprint],
    isLoading: false,
  } as ReturnType<typeof useSprints>)
  vi.mocked(sprintsService.sprintsApi.update).mockResolvedValue(fakeSprint)
  mockPushStatus([])
})

describe('EditPIModal', () => {
  it('renders the Edit PI title when open', () => {
    render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Edit PI')).toBeInTheDocument()
  })

  it('pre-fills the name field with the current PI name', () => {
    render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Q1-2026')
  })

  it('renders sprint rows when sprints data is available', async () => {
    render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Sprint 1')).toBeInTheDocument())
  })

  it('Save calls updatePI.mutateAsync with the modified name', async () => {
    updateMutateAsync.mockResolvedValue(fakePI)
    render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Q2-2026')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ piId: 'pi-1', body: expect.objectContaining({ name: 'Q2-2026' }) }),
      ),
    )
  })

  it('Save calls sprintsApi.update for each sprint', async () => {
    updateMutateAsync.mockResolvedValue(fakePI)
    render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Sprint 1'))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(sprintsService.sprintsApi.update).toHaveBeenCalledWith(
        's-1',
        expect.objectContaining({ available: 10 }),
      ),
    )
  })

  it('Cancel button calls onClose', async () => {
    const onClose = vi.fn()
    render(<EditPIModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  describe('when a team derives the project’s Available (§6.4)', () => {
    it('saves the dates without sending Available, which the API refuses', async () => {
      mockPushStatus([derivedStatus()])
      updateMutateAsync.mockResolvedValue(fakePI)
      render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
      await waitFor(() => screen.getByText('Sprint 1'))

      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      await waitFor(() => expect(sprintsService.sprintsApi.update).toHaveBeenCalled())
      const body = vi.mocked(sprintsService.sprintsApi.update).mock.calls[0][1]
      expect(body).not.toHaveProperty('available')
      expect(body).toMatchObject({ start_date: null, end_date: null })
    })

    it('shows Available read-only, and says which team owns it', async () => {
      mockPushStatus([derivedStatus()])
      render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
      await waitFor(() => screen.getByText('Sprint 1'))

      expect(screen.getByRole('spinbutton')).toHaveAttribute('readonly')
      expect(screen.getByText(/derived from team Platform/i)).toBeInTheDocument()
    })

    it('still sends Available when the project is manual', async () => {
      mockPushStatus([derivedStatus({ available_source: 'manual' })])
      updateMutateAsync.mockResolvedValue(fakePI)
      render(<EditPIModal {...defaultProps} />, { wrapper: makeWrapper() })
      await waitFor(() => screen.getByText('Sprint 1'))

      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      await waitFor(() =>
        expect(sprintsService.sprintsApi.update).toHaveBeenCalledWith(
          's-1',
          expect.objectContaining({ available: 10 }),
        ),
      )
    })
  })

  it('reports a failed sprint write instead of closing over a half-applied edit', async () => {
    updateMutateAsync.mockResolvedValue(fakePI)
    vi.mocked(sprintsService.sprintsApi.update).mockRejectedValue(new Error('409'))
    const onClose = vi.fn()
    render(<EditPIModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByText('Sprint 1'))

    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save every change/i)
    expect(onClose).not.toHaveBeenCalled()
  })
})
