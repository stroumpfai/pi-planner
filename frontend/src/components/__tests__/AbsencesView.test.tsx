import { vi, type Mock } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AbsencesView, deletePrompt } from '../AbsencesView'
import * as apiModule from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { Absence, TeamMember, User } from '@/types'

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

/** Today is pinned so the grid's four months never slide under the assertions. */
const TODAY = new Date('2026-09-15T09:00:00Z')

const version = {
  system_id: 'v-1',
  member_id: 'm-1',
  effective_from: '2026-01-01',
  mon_am: true, mon_pm: true,
  tue_am: true, tue_pm: true,
  wed_am: true, wed_pm: true,
  thu_am: true, thu_pm: true,
  fri_am: true, fri_pm: true,
  sat_am: false, sat_pm: false,
  sun_am: false, sun_pm: false,
  hours_per_day: 8,
  focus: 1,
  note: null,
  created_at: '2026-01-01T00:00:00Z',
  modified_at: '2026-01-01T00:00:00Z',
  etag: '"v"',
}

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
    effective_version: { ...version, member_id: id },
  }) as TeamMember

const absence = (over: Partial<Absence> = {}): Absence =>
  ({
    system_id: 'ab-1',
    team_id: 't-1',
    member_id: 'm-1',
    label: 'Summer holiday',
    kind: 'range',
    start_date: '2026-09-14',
    end_date: '2026-09-15',
    start_half: 'am',
    end_half: 'pm',
    weekday: null,
    halves: null,
    interval_weeks: null,
    summary: '2026-09-14 – 2026-09-15, from am to pm',
    occurrences: [
      { date: '2026-09-14', halves: ['am', 'pm'] },
      { date: '2026-09-15', halves: ['am', 'pm'] },
    ],
    created_at: '2026-01-01T00:00:00Z',
    modified_at: '2026-01-01T00:00:00Z',
    etag: '"absence-tag"',
    ...over,
  }) as Absence

function respondWith(members: TeamMember[], absences: Absence[]) {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url.includes('/absences') ? absences : members, headers: {} }),
  )
}

describe('AbsencesView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(TODAY)
    vi.clearAllMocks()
    useAuthStore.setState({ user: { username: 'u', role: 'editor' } as User, isEditing: false })
    respondWith([member('m-1', 'Marta Lindqvist'), member('m-2', 'Rui Domingues')], [absence()])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads a year for the minimap and draws six months of it', async () => {
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })

    await screen.findByRole('grid', { name: /absences by member/i })
    const call = mockApi.get.mock.calls.find(([url]: [string]) => url.includes('/absences'))
    // The strip is a year wide; the grid below is a slice of it (§7.4).
    expect(call?.[1]?.params).toEqual({ from: '2026-09-01', to: '2027-08-31' })
    const header = within(screen.getByLabelText('Months shown'))
    expect(header.getByText('Sep 2026')).toBeInTheDocument()
    expect(header.getByText('Feb 2027')).toBeInTheDocument()
  })

  it('gives every member a row', async () => {
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    expect(await screen.findByText('Marta Lindqvist')).toBeInTheDocument()
    expect(screen.getByText('Rui Domingues')).toBeInTheDocument()
  })

  it('selects an entry when its cell is clicked, with delete beside edit', async () => {
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Marta Lindqvist · 2026-09-14 am'))

    // Delete is its own action, never buried inside the edit dialog (§7.4).
    expect(await screen.findByRole('button', { name: /delete absence for Marta/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit absence for Marta/i })).toBeInTheDocument()
    expect(screen.getByText(/Summer holiday/)).toBeInTheDocument()
  })

  it('leaves nothing selected when an empty cell is clicked', async () => {
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Rui Domingues · 2026-09-14 am'))
    expect(screen.queryByRole('button', { name: /delete absence/i })).not.toBeInTheDocument()
  })

  it('names the whole series in the delete confirm, and offers no per-occurrence choice', async () => {
    const user = userEvent.setup()
    mockApi.delete.mockResolvedValue({ data: null })
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Marta Lindqvist · 2026-09-14 am'))
    await user.click(await screen.findByRole('button', { name: /delete absence for Marta/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/this occurrence/i)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /^Delete$/ }))
    await waitFor(() =>
      expect(mockApi.delete).toHaveBeenCalledWith('/teams/t-1/absences/ab-1', {
        headers: { 'If-Match': '"absence-tag"' },
      }),
    )
  })

  it('shows yours and theirs on a 412, rather than a spinner', async () => {
    const user = userEvent.setup()
    mockApi.delete.mockRejectedValue({
      response: {
        status: 412,
        data: {
          detail: {
            error: 'STALE',
            message: 'changed',
            current: absence({ summary: '2026-09-14 – 2026-09-25, from am to pm' }),
          },
        },
      },
    })
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Marta Lindqvist · 2026-09-14 am'))
    await user.click(await screen.findByRole('button', { name: /delete absence for Marta/i }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Delete$/ }))

    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText(/changed under you/i)).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /keep theirs/i })).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /reapply mine/i })).toBeInTheDocument()
  })

  it('sends an edit conflict to the banner and closes the form over it', async () => {
    const user = userEvent.setup()
    mockApi.patch.mockRejectedValue({
      response: {
        status: 412,
        data: {
          detail: {
            error: 'STALE',
            message: 'changed',
            current: absence({ summary: '2026-09-14 – 2026-09-25, from am to pm' }),
          },
        },
      },
    })
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Marta Lindqvist · 2026-09-14 am'))
    await user.click(await screen.findByRole('button', { name: /edit absence for Marta/i }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }))

    // The dialog gets out of the way: the comparison belongs beside the grid.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText(/changed under you/i)).toBeInTheDocument()
    expect(within(banner).getByText(/2026-09-25/)).toBeInTheDocument()
  })

  it('hides every write affordance from a reader, and keeps the grid', async () => {
    useAuthStore.setState({ user: { username: 'r', role: 'reader' } as User, isEditing: false })
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })

    await screen.findByRole('grid', { name: /absences by member/i })
    expect(screen.queryByRole('button', { name: /add absence/i })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('puts the clicked minimap month first in the calendar', async () => {
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByRole('button', { name: /Show Dec 2026/ }))
    await waitFor(() => {
      const header = within(screen.getByLabelText('Months shown'))
      expect(header.getByText('Dec 2026')).toBeInTheDocument()
      expect(header.getByText('May 2027')).toBeInTheDocument()
      expect(header.queryByText('Sep 2026')).not.toBeInTheDocument()
    })
  })

  it('draws the frame over exactly the months it covers', async () => {
    // The bars fill the track, so the frame's percentage is the same arithmetic
    // as the bars' widths. Capping each bar instead let the frame overhang into
    // empty space and read as covering the whole year.
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    const frame = screen.getByRole('button', { name: /Showing Sep 2026 to Feb 2027/ })
    expect(frame).toHaveStyle({ left: '0%', width: '50%' })
    expect(screen.getAllByRole('button', { name: /^Show \w+ \d{4}/ })).toHaveLength(12)
  })

  it('marks the years the twelve-month strip runs across', async () => {
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    // Sep 2026 → Aug 2027: four months of one year, eight of the next.
    const strip = screen.getByLabelText(/Showing Sep 2026/).parentElement as HTMLElement
    expect(within(strip).getByText('2026')).toBeInTheDocument()
    expect(within(strip).getByText('2027')).toBeInTheDocument()
  })

  it('lands on a month past the strip’s end rather than near it', async () => {
    // The old clamp stopped at the last frame position and quietly showed a
    // different month than the one clicked.
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByRole('button', { name: /Show Aug 2027/ }))
    await waitFor(() =>
      expect(within(screen.getByLabelText('Months shown')).getByText('Aug 2027')).toBeInTheDocument(),
    )
  })

  it('moves the calendar from the jump control under the strip’s label', async () => {
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.selectOptions(screen.getByLabelText('Jump to month'), '2027-03')
    await waitFor(() => {
      const header = within(screen.getByLabelText('Months shown'))
      expect(header.getByText('Mar 2027')).toBeInTheDocument()
      expect(header.getByText('Aug 2027')).toBeInTheDocument()
    })
  })

  it('says why the grid is empty when nobody is on the team', async () => {
    respondWith([], [])
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    expect(
      await screen.findByText(/add a member before recording who is away/i),
    ).toBeInTheDocument()
  })
})

describe('deletePrompt', () => {
  it('spells out that a recurring entry goes whole', () => {
    const rule = absence({ kind: 'interval', summary: 'every 2nd Friday am, from 2026-09-04, ongoing' })
    expect(deletePrompt(rule, 'Aïcha')).toContain('every occurrence')
    expect(deletePrompt(rule, 'Aïcha')).toContain('every 2nd Friday am')
  })

  it('does not claim a one-off range has occurrences', () => {
    expect(deletePrompt(absence(), 'Marta')).not.toContain('every occurrence')
  })
})
