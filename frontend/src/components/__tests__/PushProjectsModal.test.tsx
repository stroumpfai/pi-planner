import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PushProjectsModal } from '../PushProjectsModal'
import * as apiModule from '@/services/api'
import type { PushPreview, PushSprintRow, TeamAssignment } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const assignment = (over: Partial<TeamAssignment> = {}): TeamAssignment => ({
  system_id: 'a-1',
  team_id: 't-1',
  project_id: 'p-1',
  project_name: 'ISK Portal',
  effort_unit: 'pts',
  share_pct: 70,
  available_source: 'factor',
  units_per_pd: 1.5,
  is_anchor: true,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"tag"',
  ...over,
})

const sprintRow = (over: Partial<PushSprintRow> = {}): PushSprintRow => ({
  sprint_id: 's-1',
  pi_id: 'pi-1',
  pi_name: 'PI-7',
  pi_state: 'draft',
  sprint_number: 1,
  label: 'PI-7.1',
  start_date: '2026-04-06',
  end_date: '2026-04-17',
  current_available: 12,
  proposed_available: 14,
  delta: 2,
  team_person_days: 20,
  share_adjusted_person_days: 14,
  in_project_units: 13.8,
  available_pushed_at: null,
  ...over,
})

const preview = (over: Partial<PushPreview> = {}): PushPreview => ({
  project_id: 'p-1',
  project_name: 'ISK Portal',
  effort_unit: 'pts',
  team_id: 't-1',
  team_name: 'Platform',
  share_pct: 70,
  available_source: 'factor',
  units_per_pd: 1.5,
  sprints: [sprintRow()],
  changed_count: 1,
  total_delta: 2,
  ...over,
})

/** Previews come off GET; both push endpoints off POST. */
function respondWith(previews: Record<string, PushPreview>) {
  mockApi.get.mockImplementation((url: string) => {
    const projectId = /\/projects\/([^/]+)\//.exec(url)?.[1] ?? ''
    return Promise.resolve({ data: previews[projectId], headers: {} })
  })
}

function open(assignments: TeamAssignment[], onClose = vi.fn()) {
  return render(
    <PushProjectsModal
      open
      teamId="t-1"
      teamName="Platform"
      assignments={assignments}
      onClose={onClose}
    />,
    { wrapper: wrapper() },
  )
}

describe('PushProjectsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    respondWith({ 'p-1': preview() })
  })

  it('shows the integer that will be written, with the PD behind it', async () => {
    open([assignment()])

    const row = within(await screen.findByRole('listitem'))
    expect(row.getByText('PI-7.1')).toBeInTheDocument()
    expect(row.getByText('12 pts')).toBeInTheDocument()
    // Rounding happens in view, not silently on apply (§6.4): 13.8 → 14.
    expect(row.getByText('14 pts')).toBeInTheDocument()
    expect(row.getByText('+2')).toBeInTheDocument()
    expect(row.getByText('14.0 PD · 13.8 pts')).toBeInTheDocument()
  })

  it('writes nothing until apply is pressed', async () => {
    open([assignment()])
    await screen.findByText('PI-7.1')
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('reads an undated sprint as unknown rather than zero', async () => {
    respondWith({
      'p-1': preview({
        sprints: [
          sprintRow({
            start_date: null,
            end_date: null,
            proposed_available: null,
            delta: null,
            share_adjusted_person_days: null,
            in_project_units: null,
          }),
        ],
      }),
    })
    open([assignment()])

    const row = within(await screen.findByRole('listitem'))
    expect(row.getByText('no dates yet')).toBeInTheDocument()
    expect(row.queryByText('0 pts')).not.toBeInTheDocument()
  })

  it('does not offer a manual project, and says why it is missing', async () => {
    open([assignment(), assignment({ project_id: 'p-2', project_name: 'Data Exchange', available_source: 'manual' })])

    await screen.findByText('PI-7.1')
    expect(
      screen.getByText(/Data Exchange type their Available by hand and are not updated/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Data Exchange/ })).not.toBeInTheDocument()
  })

  it('counts the ticked projects in the apply label', async () => {
    respondWith({ 'p-1': preview(), 'p-2': preview({ project_id: 'p-2', project_name: 'Data Exchange' }) })
    open([assignment(), assignment({ project_id: 'p-2', project_name: 'Data Exchange' })])

    expect(await screen.findByRole('button', { name: 'Apply to 2 projects' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Data Exchange/ }))
    expect(screen.getByRole('button', { name: 'Apply to 1 project' })).toBeInTheDocument()
  })

  it('pushes the whole team in one call when nothing is unticked', async () => {
    mockApi.post.mockResolvedValue({
      data: {
        team_id: 't-1',
        results: [
          {
            project_id: 'p-1',
            project_name: 'ISK Portal',
            status: 'updated',
            updated_sprints: 3,
            total_delta: 6,
            message: null,
            locked_by: null,
            locked_until: null,
          },
        ],
      },
      headers: {},
    })
    open([assignment()])

    await userEvent.click(await screen.findByRole('button', { name: 'Apply to 1 project' }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/teams/t-1/push'))
    expect(await screen.findByText('✓ 3 sprints updated')).toBeInTheDocument()
  })

  it('applies only the ticked project when the selection is narrowed', async () => {
    respondWith({ 'p-1': preview(), 'p-2': preview({ project_id: 'p-2', project_name: 'Data Exchange' }) })
    mockApi.post.mockResolvedValue({
      data: {
        project_id: 'p-1',
        project_name: 'ISK Portal',
        status: 'no_change',
        updated_sprints: 0,
        total_delta: 0,
        message: null,
        locked_by: null,
        locked_until: null,
      },
      headers: {},
    })
    open([assignment(), assignment({ project_id: 'p-2', project_name: 'Data Exchange' })])

    await userEvent.click(await screen.findByRole('checkbox', { name: /Data Exchange/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 1 project' }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/projects/p-1/team-capacity/apply'),
    )
    expect(mockApi.post).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('✓ no change')).toBeInTheDocument()
  })

  it('reads a rejected single-project apply as locked, not as a generic error', async () => {
    // The single-project path throws rather than returning a result row, and the
    // lock's 409 carries no `detail.error` — so it has to be recognised by
    // `locked_by`, or the row loses the holder, the expiry and Retry this one.
    respondWith({ 'p-1': preview(), 'p-2': preview({ project_id: 'p-2', project_name: 'Data Exchange' }) })
    mockApi.post.mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            message: 'Project is being edited by mfranck',
            locked_by: 'mfranck',
            expires_at: '2026-04-20T14:32:00Z',
          },
        },
      },
    })
    open([assignment(), assignment({ project_id: 'p-2', project_name: 'Data Exchange' })])

    await userEvent.click(await screen.findByRole('checkbox', { name: /Data Exchange/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 1 project' }))

    expect(await screen.findByText(/locked by mfranck until/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry this one' })).toBeInTheDocument()
  })

  it('still reads a business 409 on that path as the refusal it is', async () => {
    respondWith({ 'p-1': preview(), 'p-2': preview({ project_id: 'p-2', project_name: 'Data Exchange' }) })
    mockApi.post.mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            error: 'SPRINT_DATES_MISALIGNED',
            message: 'Sprint 1 does not line up with Data Exchange.',
          },
        },
      },
    })
    open([assignment(), assignment({ project_id: 'p-2', project_name: 'Data Exchange' })])

    await userEvent.click(await screen.findByRole('checkbox', { name: /Data Exchange/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 1 project' }))

    expect(await screen.findByText(/does not line up/)).toBeInTheDocument()
    // Retrying a misalignment changes nothing, so it is not offered.
    expect(screen.queryByRole('button', { name: 'Retry this one' })).not.toBeInTheDocument()
  })

  it('leaves the successful rows alone when one project is locked', async () => {
    mockApi.post.mockResolvedValue({
      data: {
        team_id: 't-1',
        results: [
          {
            project_id: 'p-1',
            project_name: 'ISK Portal',
            status: 'updated',
            updated_sprints: 2,
            total_delta: 4,
            message: null,
            locked_by: null,
            locked_until: null,
          },
          {
            project_id: 'p-2',
            project_name: 'Data Exchange',
            status: 'locked',
            updated_sprints: 0,
            total_delta: 0,
            message: 'Locked by mfranck',
            locked_by: 'mfranck',
            locked_until: '2026-04-20T14:32:00Z',
          },
        ],
      },
      headers: {},
    })
    respondWith({ 'p-1': preview(), 'p-2': preview({ project_id: 'p-2', project_name: 'Data Exchange' }) })
    open([assignment(), assignment({ project_id: 'p-2', project_name: 'Data Exchange' })])

    await userEvent.click(await screen.findByRole('button', { name: 'Apply to 2 projects' }))

    // Partial success is the normal outcome, not an error (§6.7).
    expect(await screen.findByText('✓ 2 sprints updated')).toBeInTheDocument()
    expect(screen.getByText(/locked by mfranck until/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry this one' })).toBeInTheDocument()
  })

  it('retries just the locked row', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        team_id: 't-1',
        results: [
          {
            project_id: 'p-1',
            project_name: 'ISK Portal',
            status: 'locked',
            updated_sprints: 0,
            total_delta: 0,
            message: 'Locked by mfranck',
            locked_by: 'mfranck',
            locked_until: '2026-04-20T14:32:00Z',
          },
        ],
      },
      headers: {},
    })
    mockApi.post.mockResolvedValueOnce({
      data: {
        project_id: 'p-1',
        project_name: 'ISK Portal',
        status: 'updated',
        updated_sprints: 4,
        total_delta: 8,
        message: null,
        locked_by: null,
        locked_until: null,
      },
      headers: {},
    })
    open([assignment()])

    await userEvent.click(await screen.findByRole('button', { name: 'Apply to 1 project' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Retry this one' }))

    expect(await screen.findByText('✓ 4 sprints updated')).toBeInTheDocument()
    expect(mockApi.post).toHaveBeenLastCalledWith('/projects/p-1/team-capacity/apply')
  })

  it('says there is nothing to push when every project types Available by hand', async () => {
    open([assignment({ available_source: 'manual' })])

    expect(
      await screen.findByText(/No project served by this team derives its Available/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument()
  })

  it('explains a closed PI rather than showing an empty table', async () => {
    respondWith({ 'p-1': preview({ sprints: [], changed_count: 0, total_delta: 0 }) })
    open([assignment()])

    expect(await screen.findByText(/No open sprint to update/)).toBeInTheDocument()
  })
})
