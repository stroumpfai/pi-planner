import { vi, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MeetingDialog, describeMeetingDraft, formatDuration } from '../MeetingDialog'
import * as apiModule from '@/services/api'
import type { Meeting, TeamMember } from '@/types'

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

const member = (id: string, name: string): TeamMember =>
  ({ system_id: id, team_id: 't-1', name, role: null, organisation: null }) as TeamMember

const MEMBERS = [
  member('m-1', 'Marta Lindqvist'),
  member('m-2', 'Tomas Bergerat'),
  member('m-3', 'Aïcha Ben Salah'),
]

const WINDOW = { from: '2026-09-07', to: '2026-09-18' }

const renderDialog = (props: Partial<React.ComponentProps<typeof MeetingDialog>> = {}) =>
  render(
    <MeetingDialog
      open
      teamId="t-1"
      members={MEMBERS}
      window={WINDOW}
      onClose={props.onClose ?? vi.fn()}
      {...props}
    />,
    { wrapper: wrapper() },
  )

const lastPost = () => mockApi.post.mock.calls[mockApi.post.mock.calls.length - 1]

describe('MeetingDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.post.mockResolvedValue({ data: {} })
    mockApi.patch.mockResolvedValue({ data: {} })
  })

  it('writes one row with every attendee, not one row each', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/name/i), 'Sprint planning')
    await user.click(screen.getByRole('button', { name: 'all 3' }))
    await user.type(screen.getByLabelText(/^On$/i), '07.09.2026')
    await user.clear(screen.getByLabelText(/^Duration/))
    await user.type(screen.getByLabelText(/^Duration/), '120')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const [url, body] = lastPost()
    expect(url).toBe('/teams/t-1/meetings')
    expect(body.member_ids).toEqual(['m-1', 'm-2', 'm-3'])
    expect(body.duration_minutes).toBe(120)
    expect(body.half).toBe('am')
  })

  it('saves a meeting nobody attends yet — the schedule comes first', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/name/i), 'Workshop')
    await user.type(screen.getByLabelText(/^On$/i), '08.09.2026')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(lastPost()[1].member_ids).toEqual([])
  })

  it('sends a recurring rule whole, with the weekday it repeats on', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/name/i), 'Stand-up')
    await user.click(screen.getByRole('tab', { name: 'Weekly' }))
    await user.selectOptions(screen.getByLabelText(/weekday/i), '1')
    await user.type(screen.getByLabelText(/runs from/i), '01.09.2026')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    const body = lastPost()[1]
    expect(body).toMatchObject({ kind: 'weekly', weekday: 1, start_date: '2026-09-01' })
    expect(body.interval_weeks).toBeNull()
  })

  it('previews the fortnight, because an off-by-one week is invisible in the rule', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('tab', { name: 'Interval' }))
    await user.selectOptions(screen.getByLabelText(/weekday/i), '4')
    await user.type(screen.getByLabelText(/first occurrence/i), '04.09.2026')
    // The date field commits on blur, as it does everywhere in the app.
    await user.tab()

    expect(await screen.findByText('2026-09-04')).toBeInTheDocument()
    expect(screen.getByText('2026-09-18')).toBeInTheDocument()
  })

  it('refuses a duration off the five-minute step before it reaches the API', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/name/i), 'Chat')
    await user.type(screen.getByLabelText(/^On$/i), '08.09.2026')
    await user.clear(screen.getByLabelText(/^Duration/))
    await user.type(screen.getByLabelText(/^Duration/), '7')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/steps of 5/i)
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('accepts an 8 h workshop — length belongs to the meeting, not the attendee', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/name/i), 'Architecture workshop')
    await user.type(screen.getByLabelText(/^On$/i), '08.09.2026')
    await user.selectOptions(screen.getByLabelText(/common durations/i), '480')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled())
    expect(lastPost()[1].duration_minutes).toBe(480)
  })

  it('edits with the row’s ETag, and offers no per-occurrence choice', async () => {
    const user = userEvent.setup()
    const editing = {
      system_id: 'mt-1',
      team_id: 't-1',
      title: 'Stand-up',
      kind: 'weekly',
      start_date: '2026-09-01',
      end_date: null,
      weekday: 1,
      interval_weeks: null,
      half: 'am',
      duration_minutes: 15,
      order_index: 0,
      member_ids: ['m-1'],
      summary: 'every Tuesday am, from 2026-09-01, ongoing',
      occurrences: ['2026-09-08'],
      created_at: '2026-01-01T00:00:00Z',
      modified_at: '2026-01-01T00:00:00Z',
      etag: '"meeting-tag"',
    } as Meeting
    renderDialog({ editing })

    expect(screen.queryByText(/this occurrence/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalled())
    const [url, , config] = mockApi.patch.mock.calls[0]
    expect(url).toBe('/teams/t-1/meetings/mt-1')
    expect(config.headers['If-Match']).toBe('"meeting-tag"')
  })
})

describe('formatDuration', () => {
  it('keeps short meetings in minutes and long ones in hours', () => {
    expect(formatDuration(15)).toBe('15 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(90)).toBe('1 h 30 min')
  })
})

describe('describeMeetingDraft', () => {
  const base = {
    kind: 'range' as const,
    startDate: '2026-09-08',
    endDate: '',
    weekday: 4,
    intervalWeeks: 2,
    half: 'am' as const,
    duration: 120,
    attendeeCount: 3,
  }

  it('says what a one-off costs, and to whom', () => {
    expect(describeMeetingDraft(base)).toBe('2026-09-08, 2 h am, 3 people')
  })

  it('says a block charges each of its days', () => {
    expect(describeMeetingDraft({ ...base, endDate: '2026-09-10' })).toContain('each day')
  })

  it('names the fortnight and its open end', () => {
    const summary = describeMeetingDraft({ ...base, kind: 'interval' })
    expect(summary).toContain('every 2 weeks on Fri')
    expect(summary).toContain('ongoing')
  })

  it('says plainly that nobody is in it yet', () => {
    expect(describeMeetingDraft({ ...base, attendeeCount: 0 })).toContain('nobody yet')
  })

  it('asks for a date before it claims a cost', () => {
    expect(describeMeetingDraft({ ...base, startDate: '' })).toMatch(/pick a date/)
  })
})
