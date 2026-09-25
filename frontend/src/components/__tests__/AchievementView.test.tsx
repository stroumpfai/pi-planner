import { vi, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AchievementView } from '../AchievementView'
import * as apiModule from '@/services/api'
import type { CapacitySprint, Project, ProjectAchievementRow, TeamAchievement } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const sprint = (over: Partial<CapacitySprint> = {}): CapacitySprint => ({
  sprint_id: 's-1',
  pi_id: 'pi-1',
  pi_name: 'Q3-2026',
  pi_state: 'draft',
  sprint_number: 1,
  label: 'Q3-2026.1',
  start_date: '2026-07-13',
  end_date: '2026-07-24',
  computable: true,
  available: 24,
  ...over,
})

/** Alpha: a factor project, in the PD total, with two items behind sprint 1. */
const alpha = (over: Partial<ProjectAchievementRow> = {}): ProjectAchievementRow => ({
  project_id: 'p-alpha',
  name: 'Alpha',
  effort_unit: 'pts',
  share_pct: 70,
  available_source: 'factor',
  units_per_pd: 1.5,
  in_pd_total: true,
  committed: [24, null],
  achieved: [21, null],
  pd_given: [16.8, null],
  velocity: [1.25, null],
  achieved_items: [
    [
      {
        system_id: 'i-1',
        id: 101,
        title: 'Login page',
        item_type: 'story',
        effort: 13,
        completed_on: '2026-07-15',
      },
      {
        system_id: 'i-2',
        id: 102,
        title: 'Session timeout bug',
        item_type: 'bug',
        effort: 8,
        completed_on: '2026-07-22',
      },
    ],
    [],
  ],
  outside_calendar_points: 0,
  done_undated_count: 0,
  item_types_without_done_state: [],
  ...over,
})

/** Beta: manual, so out of the PD total; no sprint of its own on sprint 1's dates. */
const beta = (over: Partial<ProjectAchievementRow> = {}): ProjectAchievementRow => ({
  project_id: 'p-beta',
  name: 'Beta',
  effort_unit: 'sp',
  share_pct: 30,
  available_source: 'manual',
  units_per_pd: 1,
  in_pd_total: false,
  committed: [null, null],
  achieved: [5, null],
  pd_given: [7.2, null],
  velocity: [0.69444, null],
  achieved_items: [[], []],
  outside_calendar_points: 0,
  done_undated_count: 0,
  item_types_without_done_state: [],
  ...over,
})

const report = (over: Partial<TeamAchievement> = {}): TeamAchievement => ({
  team_id: 't-1',
  anchor_project_id: 'p-alpha',
  sprints: [
    sprint(),
    sprint({ sprint_id: 's-2', sprint_number: 2, label: 'Q3-2026.2', start_date: null, end_date: null, computable: false }),
  ],
  projects: [alpha()],
  team: { achieved_pd: [19.3, null], available_pd: [24, null], realised: [0.804, null] },
  ...over,
})

const alphaProject: Project = {
  system_id: 'p-alpha',
  name: 'Alpha',
  description: null,
  azure_devops_url: 'https://devops.test/Coll/Alpha',
  work_item_path_template: '_workitems/edit/{id}',
  effort_unit: 'pts',
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
}

function serve(data: TeamAchievement) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.endsWith('/achievement')) return Promise.resolve({ data, headers: {} })
    if (url === '/projects/p-alpha') return Promise.resolve({ data: alphaProject, headers: {} })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

const block = (name: string) => within(screen.getByRole('rowgroup', { name }))

describe('AchievementView', () => {
  const onOpenProjects = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    serve(report())
  })

  it('reads the per-project rows and the team rows from the report', async () => {
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByRole('rowgroup', { name: 'Alpha' })
    expect(mockApi.get).toHaveBeenCalledWith('/teams/t-1/achievement', { params: {} })

    // Column heads: {PI}.{n}, dates beneath, as in the Capacity view.
    expect(screen.getByRole('columnheader', { name: /Q3-2026\.1/ })).toHaveTextContent('13–24 Jul')

    const a = block('Alpha')
    expect(a.getByRole('rowheader', { name: /Alpha/ })).toHaveTextContent('share 70%')
    expect(a.getByRole('row', { name: /^Committed \(pts\)/ })).toHaveTextContent('24')
    expect(a.getByRole('row', { name: /^Achieved \(pts\)/ })).toHaveTextContent('21')
    expect(a.getByRole('row', { name: /^PD given/ })).toHaveTextContent('16.8')
    expect(a.getByRole('row', { name: /^Velocity \(pts\/PD\)/ })).toHaveTextContent('1.25 pts/PD')

    const team = block('Team')
    expect(team.getByRole('row', { name: /^Achieved \(PD\)/ })).toHaveTextContent('19.3')
    expect(team.getByRole('row', { name: /^Available \(PD\)/ })).toHaveTextContent('24.0')
    expect(team.getByRole('row', { name: /^Realised/ })).toHaveTextContent('80%')
  })

  it('reads "—" for an unknown figure, never 0', async () => {
    serve(report({ projects: [alpha(), beta()] }))
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByRole('rowgroup', { name: 'Beta' })
    // The undated second sprint: every row of every block reads "—".
    for (const label of [/^Committed/, /^Achieved \(pts\)/, /^PD given/, /^Velocity/]) {
      expect(within(block('Alpha').getByRole('row', { name: label })).getAllByRole('cell')[1]).toHaveTextContent('—')
    }
    // Beta has no sprint on sprint 1's dates: Committed is unknown, Achieved still counts.
    const committed = within(block('Beta').getByRole('row', { name: /^Committed \(sp\)/ })).getAllByRole('cell')
    expect(committed[0]).toHaveTextContent('—')
    expect(block('Beta').getByRole('row', { name: /^Achieved \(sp\)/ })).toHaveTextContent('5')
    expect(block('Beta').getByRole('row', { name: /^Velocity/ })).toHaveTextContent('0.69 sp/PD')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
  })

  it('expands an Achieved cell into the items behind it', async () => {
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    const cell = await screen.findByRole('button', { name: 'Alpha achieved, Q3-2026.1: 21 pts' })
    expect(cell).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(cell)
    expect(cell).toHaveAttribute('aria-expanded', 'true')

    const list = within(screen.getByRole('list', { name: 'Items achieved by Alpha in Q3-2026.1' }))
    const items = list.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('[101] Login page')
    expect(items[0]).toHaveTextContent('13 pts · 15.07.2026')
    expect(items[1]).toHaveTextContent('[102] Session timeout bug')
    // Linked through the project's ADO template.
    expect(await list.findAllByRole('link', { name: /open work item/i })).toHaveLength(2)

    await userEvent.click(cell)
    expect(screen.queryByRole('list', { name: /Items achieved/ })).not.toBeInTheDocument()
  })

  it('names a manual project left out of the PD total and keeps its rows', async () => {
    serve(report({ projects: [alpha(), beta()] }))
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByRole('rowgroup', { name: 'Beta' })
    expect(screen.getByRole('rowgroup', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByText(/Not in the PD total: Beta/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set a factor in Projects' }))
    expect(onOpenProjects).toHaveBeenCalled()
  })

  it('shows no team block, and says why, when every project is manual', async () => {
    serve(
      report({
        projects: [beta()],
        team: { achieved_pd: [null, null], available_pd: [24, null], realised: [null, null] },
      }),
    )
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByRole('rowgroup', { name: 'Beta' })
    expect(screen.queryByRole('rowgroup', { name: 'Team' })).not.toBeInTheDocument()
    expect(screen.getByText(/No team total in person-days: every project here is/)).toBeInTheDocument()
    expect(screen.queryByText(/Not in the PD total/)).not.toBeInTheDocument()
  })

  it('shows the §5.5 footers only when they have something to say', async () => {
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })
    await screen.findByRole('rowgroup', { name: 'Alpha' })
    expect(screen.queryByText(/Outside the calendar/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Done but undated/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No done State/)).not.toBeInTheDocument()
  })

  it('lists points outside the calendar, undated done items and missing done States', async () => {
    serve(
      report({
        projects: [
          alpha({ outside_calendar_points: 3, done_undated_count: 12 }),
          beta({ done_undated_count: 1, item_types_without_done_state: ['bug'] }),
        ],
      }),
    )
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByRole('rowgroup', { name: 'Beta' })
    const outside = screen.getByText(/Outside the calendar/)
    expect(outside).toHaveTextContent('3 pts (Alpha)')
    expect(outside).not.toHaveTextContent('Beta')
    const undated = screen.getByText(/Done but undated/)
    expect(undated).toHaveTextContent('12 items (Alpha), 1 item (Beta)')
    expect(undated).toHaveTextContent(/Closed Date/)
    const noDone = screen.getByText(/No done State/)
    expect(noDone).toHaveTextContent('Beta (bugs)')
    expect(noDone).toHaveTextContent('Edit Project → Manage States')
  })

  it('sends a team with no project to the view that gives it a calendar', async () => {
    serve(report({ anchor_project_id: null, sprints: [], projects: [], team: { achieved_pd: [], available_pd: [], realised: [] } }))
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    expect(await screen.findByText(/assign a project to give the team a sprint calendar/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Assign a project' }))
    expect(onOpenProjects).toHaveBeenCalled()
  })

  it('says so when the report cannot be read', async () => {
    mockApi.get.mockRejectedValue(new Error('boom'))
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/)
  })

  it('shows a loading line while the report is computed', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    expect(screen.getByText('Computing achievement…')).toBeInTheDocument()
  })

  it('pages through the sprint window six columns at a time', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      sprint({
        sprint_id: `s-${i + 1}`,
        sprint_number: i + 1,
        label: `Q3-2026.${i + 1}`,
        start_date: `2026-0${7 + Math.floor(i / 2)}-0${1 + (i % 2) * 5}`,
        end_date: `2026-0${7 + Math.floor(i / 2)}-0${4 + (i % 2) * 5}`,
      }),
    )
    const eight = <T,>(value: T) => Array.from({ length: 8 }, () => value)
    serve(
      report({
        sprints: many,
        projects: [
          alpha({
            committed: eight(1),
            achieved: eight(null),
            pd_given: eight(1),
            velocity: eight(null),
            achieved_items: eight([]),
          }),
        ],
        team: { achieved_pd: eight(null), available_pd: eight(1), realised: eight(null) },
      }),
    )
    render(<AchievementView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByRole('columnheader', { name: /Q3-2026\.6/ })
    expect(screen.queryByRole('columnheader', { name: /Q3-2026\.7/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Later sprints' }))
    expect(screen.getByRole('columnheader', { name: /Q3-2026\.8/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^Q3-2026\.1 / })).not.toBeInTheDocument()
  })
})
