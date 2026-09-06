import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AssignProjectModal } from '../AssignProjectModal'
import { useProjects } from '@/hooks/useProjects'
import { useAssignProject } from '@/hooks/useTeamProjects'
import type { Project } from '@/types'

vi.mock('@/hooks/useProjects')
vi.mock('@/hooks/useTeamProjects')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const project = {
  system_id: 'p-1',
  name: 'ISK Portal',
  effort_unit: 'pts',
} as unknown as Project

const defaultProps = {
  open: true,
  teamId: 't-1',
  assigned: [],
  onClose: vi.fn(),
}

/** The 409 the backend raises when the two calendars do not line up (§6.8). */
const misaligned = {
  response: {
    status: 409,
    data: {
      detail: {
        error: 'SPRINT_DATES_MISALIGNED',
        message:
          "'ISK Portal' cannot join this team yet: its sprint dates do not match the projects already served.",
        conflicts: [
          {
            sprint_number: 2,
            project_name: 'ISK Portal',
            pi_name: 'PI-7',
            start_date: '2026-04-06',
            end_date: '2026-04-17',
            other_project_id: 'p-2',
            other_project_name: 'Data Exchange',
            other_pi_name: 'PI-7',
            other_start_date: '2026-04-13',
            other_end_date: '2026-04-24',
          },
        ],
      },
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useProjects).mockReturnValue({ data: [project] } as ReturnType<typeof useProjects>)
  vi.mocked(useAssignProject).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useAssignProject>)
})

async function submitWith(err: unknown) {
  mutateAsync.mockRejectedValue(err)
  render(<AssignProjectModal {...defaultProps} />, { wrapper: makeWrapper() })
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
  await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))
}

describe('AssignProjectModal', () => {
  it('shows the backend’s reason when the sprint calendars disagree', async () => {
    // Retrying can never fix misalignment, so "please try again" is the one
    // thing this must not say.
    await submitWith(misaligned)

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match the projects/i)
    expect(screen.queryByText(/please try again/i)).not.toBeInTheDocument()
  })

  it('names the sprints that have to move', async () => {
    await submitWith(misaligned)

    const conflict = await screen.findByText(/Sprint 2 of PI-7 runs/)
    expect(conflict).toHaveTextContent('2026-04-06')
    expect(conflict).toHaveTextContent('Data Exchange')
    expect(conflict).toHaveTextContent('2026-04-24')
  })

  it('falls back to try-again for a failure it cannot explain', async () => {
    await submitWith(new Error('network'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/please try again/i)
  })

  it('assigns the project when the API accepts it', async () => {
    mutateAsync.mockResolvedValue({})
    const onClose = vi.fn()
    render(<AssignProjectModal {...defaultProps} onClose={onClose} />, { wrapper: makeWrapper() })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /project/i }), 'p-1')
    await userEvent.click(screen.getByRole('button', { name: /^assign project$/i }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p-1' })),
    )
    expect(onClose).toHaveBeenCalled()
  })
})
