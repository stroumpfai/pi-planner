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

/**
 * Give every element a measured width, as a real layout would.
 *
 * jsdom reports 0 for everything, which is exactly the "not measured yet" case
 * the strip already falls back on — so a test about what a wide screen shows has
 * to supply the width the browser would.
 */
function withScreenWidth(width: number) {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    return { ...original.call(this), width, left: 0, right: width } as DOMRect
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

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

  it('carries three years of density on a wide screen, and fetches them', async () => {
    // 2480px / 64px = 38 columns, snapped down to three whole years.
    const restore = withScreenWidth(2480)
    try {
      render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
      await screen.findByRole('grid', { name: /absences by member/i })

      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: /^Show \w+ \d{4}/ })).toHaveLength(36),
      )
      // The strip is also the read window: three years of bars, three years read.
      await waitFor(() => {
        const calls = mockApi.get.mock.calls.filter(([url]: [string]) => url.includes('/absences'))
        expect(calls[calls.length - 1][1].params).toEqual({
          from: '2026-09-01',
          to: '2029-08-31',
        })
      })
      // The frame still covers six months — a sixth of the strip, not a half.
      expect(screen.getByRole('button', { name: /Showing Sep 2026 to Feb 2027/ })).toHaveStyle({
        width: `${(6 / 36) * 100}%`,
      })
    } finally {
      restore()
    }
  })

  it('keeps the calendar at six months however wide the screen', async () => {
    // Wider screens buy bigger cells, not more time: the half-day a person reads
    // is the same size wherever they read it.
    const restore = withScreenWidth(2480)
    try {
      render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
      await screen.findByRole('grid', { name: /absences by member/i })

      const header = within(screen.getByLabelText('Months shown'))
      expect(header.getByText('Sep 2026')).toBeInTheDocument()
      expect(header.getByText('Feb 2027')).toBeInTheDocument()
      expect(header.queryByText('Mar 2027')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('leaves the jump control room for its own chevron', async () => {
    // The forms plugin draws the arrow as a background image and reserves
    // padding for it. Shrinking one without the other is what put the arrow on
    // top of the text, and nothing about that is visible in a class name.
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    const jump = screen.getByLabelText('Jump to month')
    const chevron = Number.parseFloat(jump.style.backgroundSize)
    const padding = Number.parseFloat(jump.style.paddingRight)
    expect(chevron).toBeGreaterThan(0)
    expect(padding).toBeGreaterThan(chevron)
  })

  it('marks the months in the header and leaves the rows clean', async () => {
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    const grid = await screen.findByRole('grid', { name: /absences by member/i })

    // Six labels, and nothing dividing the cells: the rule belongs to the header
    // alone, so the rows stay a plain run of half-days.
    const header = screen.getByLabelText('Months shown')
    expect(header.querySelectorAll('[style*="flex"]')).toHaveLength(6)
    expect(grid.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
  })

  it('keeps each month label weighted by its own days', async () => {
    // The alignment invariant. The header divides by day count and the rows
    // divide by day count, and nothing in either consumes width the other does
    // not — so a label cannot drift off the days it names.
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    const grid = await screen.findByRole('grid', { name: /absences by member/i })

    const row = within(grid).getByText('Marta Lindqvist').parentElement as HTMLElement
    const daysPerMonth = new Map<string, number>()
    for (const day of row.querySelectorAll<HTMLElement>('[data-day]')) {
      const month = (day.dataset.day as string).slice(0, 7)
      daysPerMonth.set(month, (daysPerMonth.get(month) ?? 0) + 1)
    }
    expect([...daysPerMonth.values()]).toEqual([30, 31, 30, 31, 31, 28])

    const labels = [...screen.getByLabelText('Months shown').querySelectorAll<HTMLElement>('[style*="flex"]')]
    expect(labels.map((label) => label.style.flexGrow)).toEqual(
      [...daysPerMonth.values()].map(String),
    )
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

  it('stacks the morning above the afternoon in one column per day', async () => {
    // The change itself: a day is one column, not two cells side by side, so a
    // morning off is the top half of that column filled.
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    const grid = await screen.findByRole('grid', { name: /absences by member/i })

    const column = grid.querySelector<HTMLElement>('[data-day="2026-09-14"]')
    const halves = [...(column?.querySelectorAll<HTMLElement>('[data-half]') ?? [])]
    expect(halves.map((cell) => cell.dataset.half)).toEqual(['am', 'pm'])
    expect(column?.className).toContain('flex-col')
  })

  it('rules every day the same width and colours only the Monday', async () => {
    // The alignment invariant, in the one place it is easy to break. Giving
    // Mondays a border the other six lack would make those columns a pixel
    // wider, and six months on the month labels would sit over the wrong days.
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    const grid = await screen.findByRole('grid', { name: /absences by member/i })

    const day = (date: string) => grid.querySelector<HTMLElement>(`[data-day="${date}"]`)
    // 14 September 2026 is a Monday; the 15th is not.
    expect(day('2026-09-14')?.className).toContain('border-l')
    expect(day('2026-09-15')?.className).toContain('border-l')
    expect(day('2026-09-14')?.className).not.toContain('border-transparent')
    expect(day('2026-09-15')?.className).toContain('border-transparent')
  })

  it('no longer explains a half-day as a case of its own', async () => {
    // It used to need a sentence. Stacking the halves made the sentence into
    // the picture, so what is left is how to read a column.
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    expect(screen.queryByText(/fills half a cell/i)).not.toBeInTheDocument()
    expect(screen.getByText(/morning above, afternoon below/i)).toBeInTheDocument()
  })

  it('walks right by a whole day, because right is the time axis now', async () => {
    // Under the old side-by-side layout ArrowRight stepped am → pm on the same
    // day. With the halves stacked that step is downwards, and right is a day.
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Marta Lindqvist · 2026-09-16 am'))
    await user.keyboard('{ }{Shift>}{ArrowRight}{/Shift}{Enter}')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('absence-summary')).toHaveTextContent(
      '2026-09-16 – 2026-09-17, am to am, 1 person',
    )
  })

  it('walks down a half-day at a time, through both people’s afternoons', async () => {
    // The vertical axis is the stack of half-days, not the list of members, so
    // ArrowDown twice from a morning reaches the person below — never a
    // half-day skipped at the seam.
    const user = userEvent.setup()
    render(<AbsencesView teamId="t-1" />, { wrapper: wrapper() })
    await screen.findByRole('grid', { name: /absences by member/i })

    await user.click(screen.getByTitle('Marta Lindqvist · 2026-09-16 am'))
    // Three steps to cross two people: Marta pm, Rui am, Rui pm. The stride is
    // a half-day, so the afternoons are reachable at all — under the old layout
    // one step landed on Rui and the rest clamped there, morning forever.
    await user.keyboard('{ }{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}{Enter}')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('absence-summary')).toHaveTextContent(
      '2026-09-16, both halves, 2 people',
    )
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
