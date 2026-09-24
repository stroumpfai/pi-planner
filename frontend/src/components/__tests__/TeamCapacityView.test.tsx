import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TeamCapacityView } from '../TeamCapacityView'
import * as apiModule from '@/services/api'
import type { CapacityBreakdown, TeamCapacity } from '@/types'

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const mockApi = apiModule.api as unknown as { get: Mock; post: Mock; patch: Mock; delete: Mock }

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

/** Alice from the worked example: 80 h contracted, one day off, 2 h of meetings. */
const alice: CapacityBreakdown = {
  contracted_half_days: 20,
  contracted_hours: 80,
  absent_half_days: 2,
  hours_after_absences: 72,
  meeting_hours: 3,
  hours_after_meetings: 69,
  net_hours: 55.2,
  person_days: 6.9,
  present_days: 9,
}

const sprint = (over: Partial<TeamCapacity['sprints'][number]> = {}) => ({
  sprint_id: 's-1',
  pi_id: 'pi-1',
  pi_name: 'Q2-2026',
  pi_state: 'draft',
  sprint_number: 1,
  label: 'Q2-2026.1',
  start_date: '2026-04-06',
  end_date: '2026-04-17',
  computable: true,
  available: 12,
  ...over,
})

const report = (over: Partial<TeamCapacity> = {}): TeamCapacity => ({
  team_id: 't-1',
  normal_day_hours: 8,
  anchor_project_id: 'p-1',
  sprints: [sprint()],
  members: [{ member_id: 'm-1', name: 'Marta Lindqvist', counts_towards_capacity: true, cells: [alice] }],
  team: [alice],
  projects: [
    {
      project_id: 'p-1',
      name: 'ISK Portal',
      effort_unit: 'pts',
      share_pct: 70,
      available_source: 'factor',
      units_per_pd: 1.5,
      person_days: [4.83],
      units: [7.245],
      proposed_available: [7],
    },
  ],
  ...over,
})

describe('TeamCapacityView', () => {
  const onOpenProjects = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.get.mockResolvedValue({ data: report(), headers: {} })
  })

  it('leads with PD, keeps hours beneath, and separates presence', async () => {
    // One number in two units (§5.2); presence answers a different question (§7.6).
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByText('Marta Lindqvist')
    // Scoped to her row: the Team row below carries the same figures, which is
    // the point of a one-member team and not a duplicate to assert past.
    const row = within(screen.getByRole('row', { name: /Marta Lindqvist/ }))
    expect(row.getByText('6.9 PD')).toBeInTheDocument()
    expect(row.getByText('55.2 h')).toBeInTheDocument()
    expect(row.getByText('9.0 d present · 6.9 PD')).toBeInTheDocument()
  })

  it('shows a member who does not count below the total, not in it', async () => {
    // Tracked for their absences only (§3.2): their numbers are there to read,
    // under their own heading after the Team and project rows.
    mockApi.get.mockResolvedValue({
      data: report({
        members: [
          { member_id: 'm-1', name: 'Marta Lindqvist', counts_towards_capacity: true, cells: [alice] },
          { member_id: 'm-2', name: 'Pia Moser', counts_towards_capacity: false, cells: [alice] },
        ],
      }),
      headers: {},
    })
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByText('Pia Moser')
    const names = screen.getAllByRole('rowheader').map((h) => h.textContent)
    const team = names.indexOf('Team')
    expect(names.indexOf('Marta Lindqvist')).toBeLessThan(team)
    expect(names.indexOf('Pia Moser')).toBeGreaterThan(team)
    expect(screen.getByRole('rowheader', { name: 'Not counted towards capacity' })).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Pia Moser/ })).getByText('6.9 PD')).toBeInTheDocument()
  })

  it('adds no "not counted" heading when everyone counts', async () => {
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByText('Marta Lindqvist')
    expect(screen.queryByText('Not counted towards capacity')).not.toBeInTheDocument()
  })

  it('expands a cell into the chain that produced it', async () => {
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    const cell = await screen.findByRole('button', { name: /Marta Lindqvist, Q2-2026\.1: 6\.9 person-days/ })
    expect(cell).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(cell)

    // The §5.4 steps, in order, so a surprising number traces to its cause.
    expect(screen.getByText('Contracted 20 half-days')).toBeInTheDocument()
    expect(screen.getByText('− absences (2 half-days)')).toBeInTheDocument()
    expect(screen.getByText('− meetings (3.0 h)')).toBeInTheDocument()
    expect(screen.getByText('× focus')).toBeInTheDocument()
    expect(screen.getByText('÷ 8.0 h per day')).toBeInTheDocument()
    expect(cell).toHaveAttribute('aria-expanded', 'true')
  })

  it('reads "—" for a sprint without dates, never 0', async () => {
    mockApi.get.mockResolvedValue({
      data: report({
        sprints: [sprint(), sprint({ sprint_id: 's-2', sprint_number: 2, label: 'Q2-2026.2', start_date: null, end_date: null, computable: false })],
        members: [{ member_id: 'm-1', name: 'Marta Lindqvist', counts_towards_capacity: true, cells: [alice, null] }],
        team: [alice, null],
        projects: [
          {
            project_id: 'p-1', name: 'ISK Portal', effort_unit: 'pts', share_pct: 70,
            available_source: 'factor', units_per_pd: 1.5,
            person_days: [4.83, null], units: [7.245, null], proposed_available: [7, null],
          },
        ],
      }),
      headers: {},
    })
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    await screen.findByText('Marta Lindqvist')
    // Unknown, not empty — in the member row, the team row and the project row.
    expect(within(screen.getByRole('row', { name: /Marta Lindqvist/ })).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /^Team/ })).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /ISK Portal/ })).getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0.0 PD')).not.toBeInTheDocument()
  })

  it('shows the integer a push would write for a derived project', async () => {
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    expect(await screen.findByText('4.8 PD')).toBeInTheDocument()
    // The rounded value, not the 7.245 behind it: a preview that shows the float
    // lies about its own outcome (§6.4).
    expect(screen.getByText('→ 7 pts')).toBeInTheDocument()
  })

  it('marks a manual project as a reference rather than a proposal', async () => {
    mockApi.get.mockResolvedValue({
      data: report({
        projects: [
          {
            project_id: 'p-1', name: 'ISK Portal', effort_unit: 'pts', share_pct: 100,
            available_source: 'manual', units_per_pd: 1.5,
            person_days: [6.9], units: [10.5], proposed_available: [null],
          },
        ],
      }),
      headers: {},
    })
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    expect(await screen.findByText('≈ 10.5 pts · manual')).toBeInTheDocument()
  })

  it('sends a team with no project to the tab that gives it one', async () => {
    mockApi.get.mockResolvedValue({
      data: report({ anchor_project_id: null, sprints: [], members: [], team: [], projects: [] }),
      headers: {},
    })
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    expect(await screen.findByText(/no sprint calendar to count in/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Assign a project' }))
    expect(onOpenProjects).toHaveBeenCalled()
  })

  it('pages six sprints at a time', async () => {
    const sprints = Array.from({ length: 8 }, (_, index) =>
      sprint({ sprint_id: `s-${index}`, sprint_number: index + 1, label: `Q2-2026.${index + 1}` }),
    )
    mockApi.get.mockResolvedValue({
      data: report({
        sprints,
        members: [{ member_id: 'm-1', name: 'Marta Lindqvist', counts_towards_capacity: true, cells: sprints.map(() => alice) }],
        team: sprints.map(() => alice),
        projects: [],
      }),
      headers: {},
    })
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

    const header = await screen.findByRole('table')
    expect(within(header).getAllByText(/^Q2-2026\.\d$/)).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Earlier sprints' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Later sprints' }))
    await waitFor(() => expect(screen.getByText('Q2-2026.7')).toBeInTheDocument())
    expect(screen.queryByText('Q2-2026.1')).not.toBeInTheDocument()
  })
})

/**
 * Eight fortnightly sprints from 6 April 2026 — a calendar with more than one
 * page in it, and one that crosses three month ends.
 */
const calendar = () => {
  const sprints = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(Date.UTC(2026, 3, 6) + index * 14 * 86_400_000)
    const end = new Date(start.getTime() + 11 * 86_400_000)
    return sprint({
      sprint_id: `s-${index + 1}`,
      sprint_number: index + 1,
      label: `Q2-2026.${index + 1}`,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    })
  })
  return report({
    sprints,
    members: [{ member_id: 'm-1', name: 'Marta Lindqvist', counts_towards_capacity: true, cells: sprints.map(() => alice) }],
    team: sprints.map(() => alice),
    projects: [],
  })
}

describe('TeamCapacityView minimap', () => {
  const onOpenProjects = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // The strip opens on today and re-anchors onto the sprints; pinning the
    // clock is what makes "which twelve months" an assertion rather than a bet.
    vi.setSystemTime(new Date('2026-04-01T09:00:00Z'))
    vi.clearAllMocks()
    mockApi.get.mockResolvedValue({ data: calendar(), headers: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const draw = () =>
    render(<TeamCapacityView teamId="t-1" onOpenProjects={onOpenProjects} />, { wrapper: wrapper() })

  it('draws a year of bars, each one saying what its month lost', async () => {
    draw()
    await screen.findByText('Marta Lindqvist')

    expect(screen.getAllByRole('button', { name: /^Show \w+ \d{4}/ })).toHaveLength(12)
    // Alice loses 11 h a sprint to absences and meetings — 1.375 PD at an 8 h
    // day. April holds one whole sprint and eleven twelfths of the next, so its
    // bar is 2.6 PD: a sprint straddling a month end is split, not charged whole
    // to the month it starts in.
    expect(screen.getByRole('button', { name: 'Show Apr 2026 — 2.6 person-days lost' })).toBeInTheDocument()
    // Past the end of the calendar nothing is lost, rather than nothing known.
    expect(screen.getByRole('button', { name: 'Show Sep 2026 — nothing lost' })).toBeInTheDocument()
  })

  it('frames the months the visible sprints start in', async () => {
    draw()
    await screen.findByText('Marta Lindqvist')

    expect(screen.getByRole('button', { name: /Showing Apr 2026 to Sep 2026/ })).toBeInTheDocument()
  })

  it('moves the table to the sprint a clicked month names', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Marta Lindqvist')

    // July holds sprint 7 (29 Jun – 10 Jul). Six columns from there would run
    // off the end, so the window backs up to the last full page — which is what
    // puts sprint 7 on screen rather than a page of blanks after it.
    await user.click(screen.getByRole('button', { name: /^Show Jul 2026/ }))

    await waitFor(() => expect(screen.getByText('Q2-2026.7')).toBeInTheDocument())
    expect(screen.queryByText('Q2-2026.1')).not.toBeInTheDocument()
    // The frame answers with the month clicked, not with the month sprint 7
    // happens to start in: 29 June to 10 July is the sprint July asks for, and
    // a frame over June would read as the click having missed by one.
    expect(screen.getByRole('button', { name: /Showing Jul 2026 to Dec 2026/ })).toBeInTheDocument()
  })

  it('lands on the nearest sprint for a month the calendar does not reach', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Marta Lindqvist')

    // Nothing runs in 2027. The edge of the data is the honest answer, and the
    // frame follows the table there rather than hovering over empty months.
    await user.click(screen.getByRole('button', { name: /^Show Feb 2027/ }))

    await waitFor(() => expect(screen.getByText('Q2-2026.8')).toBeInTheDocument())
    // Nothing on screen reaches 2027, so the frame stays on the table rather
    // than hovering over the empty months that were asked for.
    expect(screen.getByRole('button', { name: /Showing May 2026 to Oct 2026/ })).toBeInTheDocument()
  })

  it('jumps to a month too far away to drag to', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Marta Lindqvist')

    await user.selectOptions(screen.getByLabelText('Jump to month'), '2026-07')

    await waitFor(() => expect(screen.getByText('Q2-2026.7')).toBeInTheDocument())
  })

  it('keeps the frame on the window the arrows moved', async () => {
    const user = userEvent.setup()
    draw()
    await screen.findByText('Marta Lindqvist')

    await user.click(screen.getByRole('button', { name: 'Later sprints' }))

    // Sprints 3–8 start in May: the frame is derived from the table, never
    // stored beside it, so paging moves it without a second code path.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Showing May 2026 to Oct 2026/ })).toBeInTheDocument(),
    )
  })
})
