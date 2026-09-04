import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MeetingsView, deletePrompt, personHours } from '../MeetingsView'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { Meeting, TeamCapacity, TeamMember, User } from '@/types'

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

/** Today sits inside sprint 1, so the selector's default is the one in progress. */
const TODAY = new Date('2026-09-09T09:00:00Z')

const member = (id: string, name: string): TeamMember =>
  ({
    system_id: id,
    team_id: 't-1',
    name,
    role: null,
    organisation: null,
    active_from: null,
    active_to: null,
    order_index: 0,
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: `"${id}"`,
    version_dates: ['2026-01-01'],
    absence_count: 0,
    meeting_count: 0,
    effective_version: null,
  }) as unknown as TeamMember

const meeting = (over: Partial<Meeting> = {}): Meeting =>
  ({
    system_id: 'mt-1',
    team_id: 't-1',
    title: 'Sprint planning',
    kind: 'weekly',
    start_date: '2026-09-07',
    end_date: null,
    weekday: 0,
    interval_weeks: null,
    half: 'am',
    duration_minutes: 120,
    order_index: 0,
    member_ids: ['m-1'],
    summary: 'every Monday am, from 2026-09-07, ongoing',
    occurrences: ['2026-09-07'],
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"meeting-tag"',
    ...over,
  }) as Meeting

const breakdown = (meetingHours: number) => ({
  contracted_half_days: 10,
  contracted_hours: 40,
  absent_half_days: 0,
  hours_after_absences: 40,
  meeting_hours: meetingHours,
  hours_after_meetings: 40 - meetingHours,
  net_hours: 40 - meetingHours,
  person_days: (40 - meetingHours) / 8,
  present_days: 5,
})

const capacity = (over: Partial<TeamCapacity> = {}): TeamCapacity =>
  ({
    team_id: 't-1',
    normal_day_hours: 8,
    anchor_project_id: 'p-1',
    sprints: [
      {
        sprint_id: 's-1',
        pi_id: 'pi-1',
        pi_name: 'PI 7',
        pi_state: 'draft',
        sprint_number: 1,
        label: 'PI 7.1',
        start_date: '2026-09-07',
        end_date: '2026-09-18',
        computable: true,
        available: 0,
      },
      {
        sprint_id: 's-2',
        pi_id: 'pi-1',
        pi_name: 'PI 7',
        pi_state: 'draft',
        sprint_number: 2,
        label: 'PI 7.2',
        start_date: null,
        end_date: null,
        computable: false,
        available: 0,
      },
    ],
    members: [
      { member_id: 'm-1', name: 'Marta Lindqvist', cells: [breakdown(2), null] },
      { member_id: 'm-2', name: 'Rui Domingues', cells: [breakdown(0), null] },
    ],
    team: [null, null],
    projects: [
      {
        project_id: 'p-1',
        name: 'ISK',
        effort_unit: 'pts',
        share_pct: 100,
        available_source: 'factor',
        units_per_pd: 1,
        person_days: [null, null],
        units: [null, null],
        proposed_available: [null, null],
      },
    ],
    ...over,
  }) as TeamCapacity

function respondWith(options: {
  members?: TeamMember[]
  meetings?: Meeting[]
  capacity?: TeamCapacity
}) {
  const members = options.members ?? [member('m-1', 'Marta Lindqvist'), member('m-2', 'Rui Domingues')]
  const meetings = options.meetings ?? [meeting()]
  const report = options.capacity ?? capacity()
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/meetings')) return Promise.resolve({ data: meetings, headers: {} })
    if (url.includes('/capacity')) return Promise.resolve({ data: report, headers: {} })
    return Promise.resolve({ data: members, headers: {} })
  })
}

describe('MeetingsView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(TODAY)
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    respondWith({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('draws a column per meeting and a row per member', async () => {
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByRole('columnheader', { name: /Sprint planning/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marta Lindqvist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rui Domingues' })).toBeInTheDocument()
  })

  it('carries the schedule in words in the head, since the grid has no time axis', async () => {
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    const head = await screen.findByRole('columnheader', { name: /Sprint planning/ })
    expect(within(head).getByText('every Monday am, from 2026-09-07, ongoing')).toBeInTheDocument()
    expect(within(head).getByText('2 h')).toBeInTheDocument()
    expect(within(head).getByText('Weekly')).toBeInTheDocument()
  })

  it('ticks a cell for the member who attends, and leaves the other clear', async () => {
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    const attending = await screen.findByRole('checkbox', {
      name: 'Marta Lindqvist attends Sprint planning',
    })
    expect(attending).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Rui Domingues attends Sprint planning' }),
    ).not.toBeChecked()
  })

  it('writes the whole attendee set with the row’s ETag when a cell is toggled', async () => {
    const user = userEvent.setup()
    mockApi.patch.mockResolvedValue({ data: meeting({ member_ids: ['m-1', 'm-2'] }), headers: {} })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    await user.click(
      await screen.findByRole('checkbox', { name: 'Rui Domingues attends Sprint planning' }),
    )

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    const [url, body, config] = mockApi.patch.mock.calls[0]
    expect(url).toBe('/teams/t-1/meetings/mt-1')
    expect(body).toEqual({ member_ids: ['m-1', 'm-2'] })
    expect(config.headers['If-Match']).toBe('"meeting-tag"')
  })

  it('puts everyone in a meeting from the column head, in one write', async () => {
    const user = userEvent.setup()
    mockApi.patch.mockResolvedValue({ data: meeting({ member_ids: ['m-1', 'm-2'] }), headers: {} })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    await user.click(
      await screen.findByRole('checkbox', { name: 'Everyone attends Sprint planning' }),
    )

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalledTimes(1))
    expect(mockApi.patch.mock.calls[0][1]).toEqual({ member_ids: ['m-1', 'm-2'] })
  })

  it('reads meeting load from the capacity chain, for the selected sprint', async () => {
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    // Marta's clamped meeting hours, not the meeting's gross length (§5.4) —
    // and the same figure again as the team total, since she is the only one in
    // the meeting.
    await waitFor(() => expect(screen.getAllByText('2.0 h')).toHaveLength(2))
    expect(screen.getByText('0.0 h')).toBeInTheDocument()
  })

  it('expands occurrences over the selected sprint, which is what the totals count', async () => {
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('columnheader', { name: /Sprint planning/ })

    // The first read falls back to a year, because the sprint calendar has not
    // arrived yet; once it has, the window is the selected sprint's.
    await waitFor(() => {
      const calls = mockApi.get.mock.calls.filter(([url]: [string]) => url.includes('/meetings'))
      expect(calls[calls.length - 1]?.[1]?.params).toEqual({
        from: '2026-09-07',
        to: '2026-09-18',
      })
    })
  })

  it('reads “—” for an undated sprint rather than zero', async () => {
    const user = userEvent.setup()
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    await user.selectOptions(
      await screen.findByRole('combobox', { name: /sprint for meeting load/i }),
      's-2',
    )

    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0))
    expect(screen.queryByText('2.0 h')).not.toBeInTheDocument()
    // Attendance is untouched by a sprint with no dates.
    expect(
      screen.getByRole('checkbox', { name: 'Marta Lindqvist attends Sprint planning' }),
    ).toBeChecked()
  })

  it('says why the totals are empty when the team serves no project', async () => {
    respondWith({ capacity: capacity({ anchor_project_id: null, sprints: [], projects: [] }) })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByText(/no sprint calendar to total in/i)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Marta Lindqvist attends Sprint planning' }),
    ).toBeInTheDocument()
  })

  it('counts attendees and their person-hours in the footer', async () => {
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByText('1 of 2')).toBeInTheDocument()
    // One occurrence × 2 h × one attendee — gross, unlike the clamped load column.
    expect(screen.getByText('2.0 ph')).toBeInTheDocument()
  })

  it('names the whole series in the delete confirm, and offers no per-occurrence choice', async () => {
    const user = userEvent.setup()
    mockApi.delete.mockResolvedValue({ data: null })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    await user.click(await screen.findByRole('button', { name: /actions for Sprint planning/i }))
    await user.click(await screen.findByRole('menuitem', { name: /^Delete$/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/every occurrence/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/this occurrence/i)).not.toBeInTheDocument()
  })

  it('sends the new column order when a meeting is moved left', async () => {
    const user = userEvent.setup()
    respondWith({
      meetings: [meeting(), meeting({ system_id: 'mt-2', title: 'Retro', order_index: 1 })],
    })
    mockApi.post.mockResolvedValue({ data: [], headers: {} })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    await user.click(await screen.findByRole('button', { name: /actions for Retro/i }))
    await user.click(await screen.findByRole('menuitem', { name: /move left/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(mockApi.post.mock.calls[0][0]).toBe('/teams/t-1/meetings/reorder')
    expect(mockApi.post.mock.calls[0][1]).toEqual({ order: ['mt-2', 'mt-1'] })
  })

  it('shows the yours/theirs banner on a 412 rather than a silent refetch', async () => {
    const user = userEvent.setup()
    mockApi.patch.mockRejectedValue({
      response: {
        status: 412,
        data: {
          detail: {
            error: 'STALE',
            message: 'This row changed since you read it.',
            current: meeting({ member_ids: ['m-2'] }),
          },
        },
      },
    })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    await user.click(
      await screen.findByRole('checkbox', { name: 'Rui Domingues attends Sprint planning' }),
    )

    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText(/changed under you/i)).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /keep theirs/i })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /reapply mine/i })).toBeInTheDocument()
  })

  it('gives a reader the matrix without any way to change it', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    expect(
      await screen.findByRole('checkbox', { name: 'Marta Lindqvist attends Sprint planning' }),
    ).toBeDisabled()
    expect(screen.queryByRole('button', { name: /add meeting/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /everyone attends/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument()
  })

  it('offers the first meeting when there are none', async () => {
    respondWith({ meetings: [] })
    render(<MeetingsView teamId="t-1" />, { wrapper: wrapper() })

    expect(await screen.findByText(/a meeting is a column here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add the first meeting/i })).toBeInTheDocument()
  })
})

describe('personHours', () => {
  it('is occurrences × length × attendees, ungrudgingly gross', () => {
    expect(
      personHours(meeting({ occurrences: ['2026-09-07', '2026-09-14'], member_ids: ['m-1', 'm-2'] })),
    ).toBe(8)
  })

  it('is nothing for a meeting nobody attends', () => {
    expect(personHours(meeting({ member_ids: [] }))).toBe(0)
  })

  it('is nothing for a meeting with no occurrence in the window', () => {
    expect(personHours(meeting({ occurrences: [] }))).toBe(0)
  })
})

describe('deletePrompt', () => {
  it('names every occurrence of a recurring meeting', () => {
    expect(deletePrompt(meeting())).toContain('every occurrence')
  })

  it('names only the block for a one-off', () => {
    const prompt = deletePrompt(
      meeting({ kind: 'range', summary: '2026-09-08, am', title: 'Workshop' }),
    )
    expect(prompt).toContain('Workshop')
    expect(prompt).not.toContain('every occurrence')
  })
})
